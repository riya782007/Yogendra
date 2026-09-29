-- Follow-up to 0073. Found on YII/2026-27/0758 (wholesale hold):
-- the bill line has NO colour (order_items.variant_id NULL) but bd_deduct_stock reserved it on the
-- product's default colour (stock_adjustments.variant_id set). 0073 matched holds to bill lines on
-- the exact colour, so it saw "held X / billed nothing" + "billed (no colour) / held nothing" and
-- released-then-re-reserved — and because the re-reserve ran before the release, the shelf was
-- short and E652 ended up holding 1 of the 4 on the bill.
--
-- Now:
--   * A bill line WITH a colour claims holds on that exact colour.
--   * A bill line WITHOUT a colour claims any remaining hold on the same product (any colour).
--   * All releases run before any reserve, so a re-hold never finds the shelf empty.
--   * edit_order_line no longer moves held stock itself (its release with a NULL colour only
--     touched products.qty); it checks availability and the order_items trigger resyncs.
--   * Re-heal every live held order; the integrity view compares per product.

create or replace function public.resync_held_order_stock(p_order_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_hold boolean; v_status text; v_name text; pr record; hr record; it record;
  v_left int; v_n int; v_avail int; v_sku text; v_vid uuid; v_released int := 0; v_reserved int := 0;
begin
  select coalesce(cod_hold, false), coalesce(status::text, ''), customer_name
    into v_hold, v_status, v_name
    from orders where id = p_order_id for update;
  if not found or not v_hold or v_status in ('cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  -- PASS 1 — release holds no bill line claims.
  for pr in
    with b as (
      select product_id, variant_id, sum(qty)::int as q
      from order_items where order_id = p_order_id group by product_id, variant_id
    ), h as (
      select product_id, variant_id, (-sum(delta))::int as q
      from stock_adjustments where ref_id = p_order_id and kind in ('reserve', 'release')
      group by product_id, variant_id having (-sum(delta)) > 0
    ), spare as (
      select h.product_id, h.q - least(h.q, coalesce(b.q, 0)) as q
      from h left join b on h.variant_id is not null and b.product_id = h.product_id and b.variant_id = h.variant_id
    ), lh as (select product_id, sum(q)::int as q from spare group by product_id),
       lb as (select product_id, sum(q)::int as q from b where variant_id is null group by product_id)
    select lh.product_id, lh.q - coalesce(lb.q, 0) as surplus, coalesce(lb.q, 0) as loose_billed
    from lh left join lb on lb.product_id = lh.product_id
    where lh.q - coalesce(lb.q, 0) > 0
  loop
    v_left := pr.surplus;
    for hr in
      with b as (
        select variant_id, sum(qty)::int as q from order_items
        where order_id = p_order_id and product_id = pr.product_id and variant_id is not null group by variant_id
      ), h as (
        select variant_id, (-sum(delta))::int as q from stock_adjustments
        where ref_id = p_order_id and kind in ('reserve', 'release') and product_id = pr.product_id
        group by variant_id having (-sum(delta)) > 0
      )
      select h.variant_id, h.q - least(h.q, coalesce(b.q, 0)) as spare
      from h left join b on h.variant_id is not null and b.variant_id = h.variant_id
      order by 2 desc
    loop
      exit when v_left <= 0;
      continue when hr.spare <= 0;
      v_n := least(v_left, hr.spare);
      perform public.bd_add_stock(pr.product_id, hr.variant_id, v_n, null,
        'release', 'Held order edited',
        concat('Removed/reduced on bill — hold released (', coalesce(v_name, 'customer'), ')'),
        p_order_id);
      v_left := v_left - v_n;
      v_released := v_released + v_n;
    end loop;
  end loop;

  -- PASS 2a — reserve shortfall on lines billed with an exact colour.
  for it in
    with b as (
      select product_id, variant_id, sum(qty)::int as q
      from order_items where order_id = p_order_id and variant_id is not null group by product_id, variant_id
    ), h as (
      select product_id, variant_id, (-sum(delta))::int as q
      from stock_adjustments where ref_id = p_order_id and kind in ('reserve', 'release') and variant_id is not null
      group by product_id, variant_id
    )
    select b.product_id, b.variant_id, b.q - greatest(coalesce(h.q, 0), 0) as short
    from b left join h on h.product_id = b.product_id and h.variant_id = b.variant_id
    where b.q > greatest(coalesce(h.q, 0), 0)
  loop
    select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    v_n := least(it.short, greatest(coalesce(v_avail, 0), 0));
    if v_n > 0 then
      perform public.bd_deduct_stock(it.product_id, it.variant_id, v_n, v_sku, 'reserve', 'Held order edited',
        concat('Reserved for ', coalesce(v_name, 'customer')), p_order_id);
      v_reserved := v_reserved + v_n;
    end if;
  end loop;

  -- PASS 2b — reserve shortfall on colourless lines (same colour choice as place_order).
  for it in
    with b as (
      select product_id, variant_id, sum(qty)::int as q
      from order_items where order_id = p_order_id group by product_id, variant_id
    ), h as (
      select product_id, variant_id, (-sum(delta))::int as q
      from stock_adjustments where ref_id = p_order_id and kind in ('reserve', 'release')
      group by product_id, variant_id having (-sum(delta)) > 0
    ), spare as (
      select h.product_id, h.q - least(h.q, coalesce(b.q, 0)) as q
      from h left join b on h.variant_id is not null and b.product_id = h.product_id and b.variant_id = h.variant_id
    ), lh as (select product_id, sum(q)::int as q from spare group by product_id),
       lb as (select product_id, sum(q)::int as q from b where variant_id is null group by product_id)
    select lb.product_id, lb.q - coalesce(lh.q, 0) as short
    from lb left join lh on lh.product_id = lb.product_id
    where lb.q - coalesce(lh.q, 0) > 0
  loop
    -- Prefer a colour that has stock (same order as place_order); product-level if no colours.
    v_vid := null; v_avail := null; v_sku := null;
    select v.id, v.qty, upper(v.sku) into v_vid, v_avail, v_sku from variants v
      where v.product_id = it.product_id
      order by (v.qty > 0) desc, (v.id = (select default_variant_id from products where id = it.product_id)) desc nulls last, v.qty desc, v.id
      limit 1;
    if v_vid is null then
      select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id;
    end if;
    v_n := least(it.short, greatest(coalesce(v_avail, 0), 0));
    if v_n > 0 then
      perform public.bd_deduct_stock(it.product_id, v_vid, v_n, v_sku, 'reserve', 'Held order edited',
        concat('Reserved for ', coalesce(v_name, 'customer')), p_order_id);
      v_reserved := v_reserved + v_n;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'released', v_released, 'reserved', v_reserved);
end; $function$;

-- edit_order_line: identical to 0071 except the held branch only checks stock; the order_items
-- trigger (0073) resyncs the reservation after the line changes.
create or replace function public.edit_order_line(p_order_id uuid, p_item_id uuid, p_new_qty integer)
 returns jsonb language plpgsql as $function$
declare
  v_status text; v_bo boolean; v_hold boolean; v_touched boolean;
  it record; v_new int; v_delta int; v_sku text; v_avail int;
  v_old_line int; v_new_line int; v_rev_delta int; v_total int; v_bal int;
  v_channel text; v_billtype text;
begin
  select status, is_backorder, coalesce(cod_hold,false) into v_status, v_bo, v_hold from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','refunded') then raise exception 'This bill is cancelled — nothing to edit.'; end if;
  select product_id, variant_id, qty, unit_price, coalesce(line_total, unit_price*qty) as line_total
    into it from order_items where id = p_item_id and order_id = p_order_id;
  if it.product_id is null then raise exception 'Line not found on this bill'; end if;
  v_new := greatest(0, coalesce(p_new_qty, 0));
  v_delta := v_new - it.qty;
  v_old_line := coalesce(it.line_total, 0);
  v_new_line := it.unit_price * v_new;

  if v_hold and v_delta > 0 then
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if coalesce(v_avail,0) < v_delta then
      raise exception 'Only % more in stock for % — reduce the quantity or add stock first.', coalesce(v_avail,0), coalesce(v_sku,'?');
    end if;
  end if;

  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_touched;
  v_touched := (not v_hold) and (v_touched or coalesce(v_bo,false) = false);
  if v_delta <> 0 and v_touched then
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if v_delta > 0 and coalesce(v_avail,0) < v_delta then
      raise exception 'Only % more in stock for % — reduce the quantity or add stock first.', coalesce(v_avail,0), coalesce(v_sku,'?');
    end if;
    if it.variant_id is not null then
      update variants set qty = qty - v_delta where id = it.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = it.product_id), last_movement_at = now() where id = it.product_id;
    else
      update products set qty = qty - v_delta, last_movement_at = now() where id = it.product_id;
    end if;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (it.product_id, it.variant_id, v_sku, -v_delta,
              case when v_delta > 0 then 'sale' else 'return' end,
              'Bill edited', concat('Qty ', it.qty, ' → ', v_new, ' (bill corrected)'), p_order_id, now());
  end if;
  if v_new = 0 then delete from order_items where id = p_item_id;
  else update order_items set qty = v_new, line_total = v_new_line where id = p_item_id; end if;
  select coalesce(sum(coalesce(line_total, unit_price*qty)),0) into v_total from order_items where order_id = p_order_id;
  select lower(coalesce(channel::text,'')), lower(coalesce(bill_type,'')) into v_channel, v_billtype from orders where id = p_order_id;
  if v_channel = 'wholesale' and v_billtype = 'gst' then v_total := round(v_total * 1.03); end if;
  v_total := v_total + coalesce((select coalesce(extra_packing,0) + coalesce(extra_courier,0) + coalesce(extra_adjustment,0) from orders where id = p_order_id), 0);
  update orders set total = v_total where id = p_order_id;
  if v_touched then
    v_rev_delta := v_new_line - v_old_line;
    if v_rev_delta <> 0 then
      select coalesce(max(balance),0) into v_bal from ledger;
      if v_rev_delta > 0 then
        insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
          values ('sales', p_order_id, 0, v_rev_delta, v_bal + v_rev_delta, 'Bill edited — revenue increased', now());
      else
        insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
          values ('sales', p_order_id, -v_rev_delta, 0, v_bal + v_rev_delta, 'Bill edited — revenue reduced', now());
      end if;
    end if;
  end if;
  insert into audit_log(actor, action, ref, detail)
    values ('owner','order_line_edit', p_order_id::text, concat('item ', p_item_id, ': qty ', it.qty, ' → ', v_new));
  return jsonb_build_object('order_id', p_order_id, 'total', v_total, 'removed', v_new = 0);
end; $function$;

-- Re-heal every live held order with the corrected matching.
do $$
declare o record;
begin
  for o in
    select id from orders
    where coalesce(cod_hold, false) = true
      and coalesce(status::text, '') not in ('cancelled', 'refunded')
    order by created_at
  loop
    perform public.resync_held_order_stock(o.id);
  end loop;
end $$;

-- Integrity: compare per PRODUCT (a colourless bill line may be held on any colour).
drop view if exists public.system_integrity;
drop view if exists public.held_order_sync_integrity;

create view public.held_order_sync_integrity as
  with billed as (
    select order_id, product_id, sum(qty)::int as qty
    from order_items group by order_id, product_id
  ), held as (
    select ref_id as order_id, product_id, (-sum(delta))::int as qty
    from stock_adjustments where kind in ('reserve', 'release') and ref_id is not null
    group by ref_id, product_id
  )
  select o.id as order_id,
         coalesce(o.invoice_no, o.id::text) as what,
         coalesce(p.sku, '?') as sku,
         coalesce(h.qty, 0) as reserved,
         coalesce(b.qty, 0) as billed
  from held h
  join orders o on o.id = h.order_id
  left join billed b on b.order_id = h.order_id and b.product_id = h.product_id
  left join products p on p.id = h.product_id
  where coalesce(o.cod_hold, false) = true
    and coalesce(o.status::text, '') not in ('cancelled', 'refunded')
    and coalesce(h.qty, 0) > coalesce(b.qty, 0);

create view public.system_integrity as
  select 'stock_ledger (qty <> movements, or negative)'::text as rule,
         (level || ' ' || coalesce(sku,'?')) as what, drift::text as detail
  from stock_integrity
  union all
  select 'estimate_hold (non-held estimate still holding stock)',
         (status || ' · ' || coalesce(customer_name,'')), pieces_still_held::text
  from estimate_hold_integrity
  union all
  select 'cancelled_order_stock (rejected order changed stock)',
         (coalesce(invoice_no, order_id::text) || ' · ' || status), net_stock_delta::text
  from order_stock_integrity
  union all
  select 'order_hold (cancelled/missing order still reserving stock)',
         (what || ' · ' || status), pieces_still_held::text
  from order_hold_integrity
  union all
  select 'held_order_sync (removed/reduced item still reserved)',
         (what || ' · ' || sku), (reserved || ' reserved, ' || billed || ' on bill')
  from held_order_sync_integrity;
