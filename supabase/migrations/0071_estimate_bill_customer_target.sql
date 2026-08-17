-- ESTIMATE → BILL CUSTOMER TARGET. convert_estimate_v2 copied name/phone onto the order but never
-- set orders.customer_id. Promotional targeting (Customers page) sums only by customer_id, so a
-- converted estimate never counted toward the owner's spend target. Look up the directory row at
-- convert time, and back-fill existing estimate bills (create the directory row when missing).

do $$ begin
  alter type estimate_status add value if not exists 'cash_billed';
exception when duplicate_object then null; end $$;

create or replace function public.convert_estimate_v2(p_estimate_id uuid, p_bill_type text default 'gst'::text, p_allow_oversell boolean default false)
 returns jsonb
 language plpgsql
as $function$
declare v_order uuid := uuid_generate_v4(); v_total int; v_bal int; r record; e record; v_avail int; v_sku text; v_cid uuid;
begin
  select * into e from estimates where id=p_estimate_id;
  if not found then raise exception 'estimate not found'; end if;
  if e.status in ('converted','cash_billed') then raise exception 'already billed'; end if;

  for r in select ei.product_id, ei.variant_id,
                  (select count(*) from variants v where v.product_id = ei.product_id) as vcount,
                  (select upper(sku) from products where id = ei.product_id) as psku
           from estimate_items ei where ei.estimate_id = p_estimate_id loop
    if r.variant_id is null and coalesce(r.vcount,0) > 1 then
      raise exception 'Pick a colour for % before billing — it has % colours, so stock cannot be reduced correctly without one.', coalesce(r.psku,'this item'), r.vcount;
    end if;
  end loop;

  if not p_allow_oversell then
    for r in select * from estimate_items where estimate_id=p_estimate_id loop
      if r.variant_id is not null then
        select qty, upper(sku) into v_avail, v_sku from variants where id = r.variant_id;
      else
        select qty, upper(sku) into v_avail, v_sku from products where id = r.product_id;
      end if;
      if coalesce(v_avail,0) < r.qty then
        raise exception 'Only % in stock for % — estimate has %. Add stock or enable backorder.', coalesce(v_avail,0), coalesce(v_sku,'item'), r.qty;
      end if;
    end loop;
  end if;

  v_cid := null;
  if length(right(regexp_replace(coalesce(e.customer_phone,''), '\D', '', 'g'), 10)) = 10 then
    select c.id into v_cid from customers c
     where right(regexp_replace(coalesce(c.phone,''), '\D', '', 'g'), 10)
         = right(regexp_replace(e.customer_phone, '\D', '', 'g'), 10)
     limit 1;
  end if;
  if v_cid is null
     and coalesce(e.customer_phone,'') = ''
     and coalesce(nullif(btrim(e.customer_name), ''), '') <> ''
     and lower(btrim(e.customer_name)) not in ('cash (w)','cash (r)','walk-in','walk in','walkin') then
    select c.id into v_cid from customers c
     where lower(btrim(c.name)) = lower(btrim(e.customer_name))
     limit 1;
  end if;

  select coalesce(sum(line_total),0) into v_total from estimate_items where estimate_id=p_estimate_id;
  insert into orders(id, channel, status, total, payment_mode, customer_id, customer_name, customer_phone, bill_type, source_tag, created_at)
    values (v_order, 'pos', 'completed', v_total, 'pending', v_cid, e.customer_name, e.customer_phone,
            case when p_bill_type='cash' then 'cash' else 'gst' end, 'estimate', now());
  for r in select * from estimate_items where estimate_id=p_estimate_id loop
    insert into order_items(order_id, product_id, variant_id, qty, unit_price, line_total)
      values (v_order, r.product_id, r.variant_id, r.qty, r.unit_price, r.line_total);
    perform bd_deduct_stock(r.product_id, r.variant_id, r.qty,
      (select upper(sku) from products where id = r.product_id),
      'sale', 'Estimate bill', concat('Sold ', r.qty, ' (from estimate)'), v_order);
  end loop;
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values('sales', v_order, 0, v_total, v_bal+v_total, concat('Estimate billed (', p_bill_type, ')'), now());
  update estimates set status = case when p_bill_type='cash' then 'cash_billed'::estimate_status else 'converted'::estimate_status end,
         order_id = v_order, gst = (p_bill_type <> 'cash') where id=p_estimate_id;
  return jsonb_build_object('order_id', v_order, 'total', v_total, 'bill_type', p_bill_type);
end;
$function$;

-- Directory rows for already-converted estimate bills that never got a customer_id.
insert into public.customers (name, phone, type)
select distinct on (
  coalesce(
    nullif(right(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g'), 10), ''),
    lower(btrim(o.customer_name))
  )
)
  coalesce(nullif(btrim(o.customer_name), ''), right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10)),
  nullif(btrim(o.customer_phone), ''),
  'retail'
from public.orders o
where o.source_tag = 'estimate'
  and o.customer_id is null
  and o.status not in ('cancelled', 'refunded')
  and lower(btrim(coalesce(o.customer_name, ''))) not in ('cash (w)', 'cash (r)', 'walk-in', 'walk in', 'walkin', '')
  and not exists (
    select 1 from public.customers c
     where (
       length(right(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g'), 10)) = 10
       and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10)
         = right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10)
     ) or (
       coalesce(o.customer_phone, '') = ''
       and lower(btrim(c.name)) = lower(btrim(o.customer_name))
     )
  );

-- Attach unlinked bills (estimate or otherwise) to the directory by last-10 phone.
update public.orders o
   set customer_id = c.id
  from public.customers c
 where o.customer_id is null
   and length(right(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g'), 10)) = 10
   and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10)
     = right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10);

-- Named estimate bills with no phone: unique directory name only.
update public.orders o
   set customer_id = sub.cid
  from (
    select o2.id as oid, min(c.id) as cid
      from public.orders o2
      join public.customers c on lower(btrim(c.name)) = lower(btrim(o2.customer_name))
     where o2.customer_id is null
       and o2.source_tag = 'estimate'
       and coalesce(o2.customer_phone, '') = ''
       and coalesce(nullif(btrim(o2.customer_name), ''), '') <> ''
       and lower(btrim(o2.customer_name)) not in ('cash (w)', 'cash (r)', 'walk-in', 'walk in', 'walkin')
     group by o2.id
    having count(distinct c.id) = 1
  ) sub
 where o.id = sub.oid;
