-- COD cancel must RELEASE a reservation. The COD queue used to DELETE the order (assuming holds
-- never moved stock). After 0071, a COD/storefront hold deducts kind='reserve'. Deleting the order
-- left that reserve in place, so sellable qty stayed short and estimate convert failed
-- ("COD order cancel kiya but quantity reserve me dali hui hai").
--
-- This migration:
--   1) cancel_order also releases leftover holds when the bill is already cancelled (retry heals).
--   2) Heals existing leftover order holds (cancelled/deleted COD) without touching live holds
--      or genuine estimate holds.
--   3) Integrity view so a leftover order reserve cannot hide again.

create or replace function public.cancel_order(p_order_id uuid, p_reason text default 'Cancelled'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare v_status text; v_amt int := 0; v_bal int; g record; v_sku text; v_deducted boolean; v_pay int; v_unit int; v_put int;
begin
  select status into v_status from orders where id = p_order_id;
  if v_status is null then raise exception 'Order not found'; end if;

  -- Always release a leftover reservation first (idempotent). A second cancel click after a
  -- failed/partial cancel must still put the pieces back.
  perform public.release_held_order_stock(p_order_id);

  if v_status in ('cancelled','refunded') then
    update orders set is_backorder = false, cod_hold = false where id = p_order_id;
    return jsonb_build_object('order_id', p_order_id, 'already', true, 'hold_released', true);
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

  select exists(select 1 from stock_adjustments where ref_id = p_order_id and kind = 'sale') into v_deducted;
  if not v_deducted then
    update orders set status = 'cancelled', is_backorder = false, cod_hold = false where id = p_order_id;
    insert into audit_log(actor, action, ref, detail)
      values ('owner','order_cancel', p_order_id::text, coalesce(p_reason,'') || ' (hold released — no sale to reverse)');
    return jsonb_build_object('order_id', p_order_id, 'no_restock', true, 'amount', 0);
  end if;

  for g in
    select sa.product_id, sa.variant_id, sum(sa.delta) as net
    from stock_adjustments sa
    where sa.ref_id = p_order_id and sa.kind in ('sale','return')
    group by sa.product_id, sa.variant_id
    having sum(sa.delta) < 0
  loop
    v_put := -g.net;
    if g.variant_id is not null then
      update variants set qty = qty + v_put where id = g.variant_id;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = g.product_id), last_movement_at = now() where id = g.product_id;
      select upper(sku) into v_sku from variants where id = g.variant_id;
    else
      update products set qty = qty + v_put, last_movement_at = now() where id = g.product_id;
      select upper(sku) into v_sku from products where id = g.product_id;
    end if;
    select unit_price into v_unit from order_items
      where order_id = p_order_id and product_id = g.product_id
        and ((g.variant_id is null and variant_id is null) or variant_id = g.variant_id) limit 1;
    v_amt := v_amt + coalesce(v_unit,0) * v_put;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (g.product_id, g.variant_id, v_sku, v_put, 'return', 'Order cancelled', coalesce(nullif(p_reason,''),'Cancelled'), p_order_id, now());
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

-- Heal: leftover order reservations that are NOT live holds and NOT estimate holds.
-- Live COD/prepaid holds (cod_hold=true, not cancelled) stay reserved.
do $$
declare r record;
begin
  -- Cancelled / refunded orders that still net a reserve.
  for r in
    select o.id
    from orders o
    join stock_adjustments sa on sa.ref_id = o.id and sa.kind in ('reserve','release')
    where o.status in ('cancelled','refunded')
    group by o.id
    having (-sum(sa.delta)) > 0
  loop
    perform public.release_held_order_stock(r.id);
  end loop;

  -- Deleted quote/order leftovers: reserve/release rows whose ref_id is neither a live estimate
  -- nor a live order (the owner lands on "This quote is not in the list").
  for r in
    select sa.ref_id as id
    from stock_adjustments sa
    where sa.kind in ('reserve','release')
      and sa.ref_id is not null
      and not exists (select 1 from estimates e where e.id = sa.ref_id)
      and not exists (select 1 from orders o where o.id = sa.ref_id)
    group by sa.ref_id
    having (-sum(sa.delta)) > 0
  loop
    perform public.release_held_order_stock(r.id);
  end loop;

  -- Quotes that are no longer held (billed/denied/open) but still net a reserve.
  for r in
    select e.id
    from estimates e
    join stock_adjustments sa on sa.ref_id = e.id and sa.kind in ('reserve','release')
    where e.status::text <> 'held'
    group by e.id
    having (-sum(sa.delta)) > 0
  loop
    perform public.release_estimate_hold(r.id);
  end loop;
end $$;

drop view if exists public.system_integrity;
drop view if exists public.order_hold_integrity;

create view public.order_hold_integrity as
  select sa.ref_id,
         coalesce(o.invoice_no, sa.ref_id::text) as what,
         coalesce(o.status::text, 'missing-order') as status,
         (-sum(sa.delta))::int as pieces_still_held
  from stock_adjustments sa
  left join orders o on o.id = sa.ref_id
  where sa.kind in ('reserve','release')
    and not exists (select 1 from estimates e where e.id = sa.ref_id)
    and (
      o.id is null
      or o.status in ('cancelled','refunded')
    )
  group by sa.ref_id, o.invoice_no, o.status
  having (-sum(sa.delta)) > 0;

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
  from order_hold_integrity;
