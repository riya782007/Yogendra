-- Cancel a whole order: restock every line, reverse the sale in the ledger, mark it cancelled.
-- Idempotent: a second call on an already-cancelled/refunded order is a no-op.
create or replace function public.cancel_order(p_order_id uuid, p_reason text default 'Cancelled')
  returns jsonb
  language plpgsql
  security definer
as $function$
declare v_status text; v_amt int := 0; v_bal int; it record; v_sku text;
begin
  select status into v_status from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','refunded') then
    return jsonb_build_object('order_id', p_order_id, 'already', true);
  end if;

  -- Restock each line (variant-exact when present) and log the movement.
  for it in select product_id, variant_id, qty, coalesce(line_total, unit_price*qty) as line_total
            from order_items where order_id = p_order_id loop
    if coalesce(it.qty,0) <= 0 then continue; end if;
    if it.variant_id is not null then
      update variants set qty = qty + it.qty where id = it.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = it.product_id), last_movement_at = now() where id = it.product_id;
      select upper(sku) into v_sku from variants where id = it.variant_id;
    else
      update products set qty = qty + it.qty, last_movement_at = now() where id = it.product_id;
      select upper(sku) into v_sku from products where id = it.product_id;
    end if;
    v_amt := v_amt + coalesce(it.line_total,0);
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (it.product_id, it.variant_id, v_sku, it.qty, 'return', 'Order cancelled', coalesce(nullif(p_reason,''),'Cancelled'), p_order_id, now());
  end loop;

  -- Reverse the sale in the ledger (debit offsets the original sales credit).
  if v_amt > 0 then
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('sales', p_order_id, v_amt, 0, v_bal - v_amt, concat('Order cancelled: ', coalesce(nullif(p_reason,''),'')), now());
  end if;

  update orders set status = 'cancelled', is_backorder = false where id = p_order_id;
  insert into audit_log(actor, action, ref, detail) values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,''));
  return jsonb_build_object('order_id', p_order_id, 'amount', v_amt);
end; $function$;
