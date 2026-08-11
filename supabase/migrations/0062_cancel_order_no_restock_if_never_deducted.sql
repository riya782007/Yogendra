-- PHANTOM-STOCK FIX. Cancelling/rejecting an order restocked its lines even when the order had NEVER
-- deducted stock — a held COD order that the owner did NOT accept (rejected) added its quantity to stock
-- out of thin air (owner: rejected a COD, system added +10). The old guard only skipped restock for a
-- pending BACKORDER; a held COD fell through and got restocked. The correct, reliable rule is simply:
-- only put stock back if it was actually taken out (i.e. the order has a 'sale' movement). No 'sale' →
-- nothing to restock and no revenue to reverse. Data repair for the phantom restocks that already
-- happened (two rejected held orders) was applied separately.
create or replace function public.cancel_order(p_order_id uuid, p_reason text default 'Cancelled'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_status text; v_amt int := 0; v_bal int; it record; v_sku text; v_deducted boolean; v_pay int;
begin
  select status into v_status from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;
  if v_status in ('cancelled','refunded') then
    return jsonb_build_object('order_id', p_order_id, 'already', true);
  end if;

  insert into payment_method_transactions(method_id, txn_type, direction, amount, ref_type, ref_id, note, created_by, created_at)
    select method_id, 'refund', 'out', amount, 'order', p_order_id, 'Order cancelled — payment reversed', 'owner', now()
    from payment_method_transactions where ref_id = p_order_id and direction = 'in';
  select coalesce(sum(credit),0) - coalesce(sum(debit),0) into v_pay from ledger where ref_id = p_order_id and kind = 'payment';
  if coalesce(v_pay,0) > 0 then
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('payment', p_order_id, v_pay, 0, v_bal - v_pay, 'Order cancelled — payment reversed', now());
  end if;
  update orders set amount_paid = 0, pay_cash = 0, pay_bank = 0 where id = p_order_id;

  -- If the order NEVER moved stock (a held COD never confirmed, or a pending backorder), there is nothing
  -- to put back and no revenue to reverse — restocking would invent phantom stock. Just cancel it.
  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_deducted;
  if not v_deducted then
    update orders set status = 'cancelled', is_backorder = false, cod_hold = false where id = p_order_id;
    insert into audit_log(actor, action, ref, detail)
      values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,'') || ' (no stock/revenue moved — nothing to restock)');
    return jsonb_build_object('order_id', p_order_id, 'no_restock', true, 'amount', 0);
  end if;

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

  if v_amt > 0 then
    select coalesce(max(balance),0) into v_bal from ledger;
    insert into ledger(kind, ref_id, debit, credit, balance, note, created_at)
      values ('sales', p_order_id, v_amt, 0, v_bal - v_amt, concat('Order cancelled: ', coalesce(nullif(p_reason,''),'')), now());
  end if;

  update orders set status = 'cancelled', is_backorder = false, cod_hold = false where id = p_order_id;
  insert into audit_log(actor, action, ref, detail) values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,''));
  return jsonb_build_object('order_id', p_order_id, 'amount', v_amt);
end; $function$;
