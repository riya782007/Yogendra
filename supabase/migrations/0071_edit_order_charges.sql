-- Edit packing / courier / adjustment on an issued bill (same OTP-gated editor as line items).
-- COD confirmation used to post ledger as SUM(line items) while marking amount_paid = orders.total
-- (which includes courier). That left courier off the books. Confirm now posts the bill total.

create or replace function public.edit_order_charges(
  p_order_id uuid,
  p_packing bigint,
  p_courier bigint,
  p_adjustment bigint
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_status text;
  v_bo boolean;
  v_hold boolean;
  v_channel text;
  v_billtype text;
  v_old_total int;
  v_items int;
  v_total int;
  v_pack bigint;
  v_cour bigint;
  v_adj bigint;
begin
  if p_order_id is null then raise exception 'Missing bill'; end if;
  select status, coalesce(is_backorder, false), coalesce(cod_hold, false),
         lower(coalesce(channel::text, '')), lower(coalesce(bill_type, '')), coalesce(total, 0)
    into v_status, v_bo, v_hold, v_channel, v_billtype, v_old_total
    from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled', 'refunded') then raise exception 'This bill is cancelled — nothing to edit.'; end if;

  v_pack := greatest(0, coalesce(p_packing, 0));
  v_cour := greatest(0, coalesce(p_courier, 0));
  v_adj := coalesce(p_adjustment, 0);

  update orders
     set extra_packing = v_pack, extra_courier = v_cour, extra_adjustment = v_adj
   where id = p_order_id;

  select coalesce(sum(coalesce(line_total, unit_price * qty)), 0) into v_items
    from order_items where order_id = p_order_id;
  if v_channel = 'wholesale' and v_billtype = 'gst' then
    v_items := round(v_items * 1.03);
  end if;
  v_total := v_items + v_pack + v_cour + v_adj;
  update orders set total = v_total where id = p_order_id;

  -- Held COD / open backorder has not posted revenue yet — confirm/fulfil will use the new total.
  if not v_bo and not v_hold and v_total <> v_old_total then
    if v_total > v_old_total then
      insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
        values ('sales', p_order_id, 0, v_total - v_old_total, 0, 'Bill edited — charges increased', now());
    else
      insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
        values ('sales', p_order_id, v_old_total - v_total, 0, 0, 'Bill edited — charges reduced', now());
    end if;
  end if;

  insert into audit_log(actor, action, ref, detail)
    values ('owner', 'order_charges_edit', p_order_id::text,
            concat('packing ', v_pack, ' courier ', v_cour, ' adj ', v_adj, ' total ', v_old_total, ' → ', v_total));

  return jsonb_build_object('order_id', p_order_id, 'total', v_total,
    'extra_packing', v_pack, 'extra_courier', v_cour, 'extra_adjustment', v_adj);
end;
$function$;

create or replace function public.confirm_cod_order(p_order_id uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare it record; v_avail int; v_sku text; v_total int := 0; v_hold boolean; v_ordertotal int;
begin
  select cod_hold, total into v_hold, v_ordertotal from orders where id = p_order_id;
  if v_hold is null then raise exception 'Order not found'; end if;
  if not v_hold then return jsonb_build_object('order_id', p_order_id, 'already', true); end if;
  for it in select oi.product_id, oi.variant_id, oi.qty from order_items oi where oi.order_id = p_order_id loop
    if it.variant_id is not null then select qty, upper(sku) into v_avail, v_sku from variants where id = it.variant_id;
    else select qty, upper(sku) into v_avail, v_sku from products where id = it.product_id; end if;
    if coalesce(v_avail,0) < it.qty then raise exception 'Only % left in stock for % — update inventory before dispatching.', coalesce(v_avail,0), coalesce(v_sku,'?'); end if;
  end loop;
  for it in select oi.product_id, oi.variant_id, oi.qty, coalesce(oi.line_total, oi.unit_price*oi.qty) as line_total from order_items oi where oi.order_id = p_order_id loop
    if it.variant_id is not null then
      update variants set qty = qty - it.qty where id = it.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = it.product_id), last_movement_at = now() where id = it.product_id;
      select upper(sku) into v_sku from variants where id = it.variant_id;
    else
      update products set qty = qty - it.qty, last_movement_at = now() where id = it.product_id;
      select upper(sku) into v_sku from products where id = it.product_id;
    end if;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (it.product_id, it.variant_id, v_sku, -it.qty, 'sale', 'COD dispatched', concat('Sold ', it.qty, ' (COD confirmed)'), p_order_id, now());
  end loop;
  -- Revenue is the bill as it stands now (goods + packing/courier/adjustment), not items alone.
  v_total := coalesce(v_ordertotal, 0);
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
    values ('sales', p_order_id, 0, v_total, 0, 'COD dispatched → sale', now());
  update orders set cod_hold = false, amount_paid = v_total where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'amount', v_total);
end;
$function$;
