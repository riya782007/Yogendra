-- Blythe Diva — 0034: Accounting & ERP audit fixes (applied to production 2026-07-01).
-- Idempotent. Keeps the repo in sync with the live database.

-- 1) Sales returns now record a STOCK MOVEMENT (every inventory change must have a source).
--    Previously record_sales_return changed products.qty directly with no stock_adjustments row,
--    so returns never showed in Stock Movement / the Product Ledger and drifted inventory.
create or replace function public.record_sales_return(p_order_id uuid, p_reason text, p_items jsonb)
returns jsonb language plpgsql security definer as $function$
declare v_id uuid := uuid_generate_v4(); it jsonb; v_qty int:=0; v_amt int:=0; v_bal int;
        v_prod uuid; v_variant uuid; v_unit int; v_sku text; v_iqty int;
begin
  for it in select * from jsonb_array_elements(p_items) loop
    v_prod := (it->>'product_id')::uuid;
    v_variant := nullif(it->>'variant_id','')::uuid;
    v_iqty := (it->>'qty')::int;
    if v_iqty is null or v_iqty <= 0 then continue; end if;
    select unit_price into v_unit from order_items where order_id=p_order_id and product_id=v_prod limit 1;
    if v_variant is not null then
      update variants set qty = qty + v_iqty where id = v_variant;
      update products set qty = (select coalesce(sum(qty),0) from variants where product_id = v_prod), last_movement_at=now() where id=v_prod;
      select upper(sku) into v_sku from variants where id = v_variant;
    else
      update products set qty = qty + v_iqty, last_movement_at=now() where id=v_prod;
      select upper(sku) into v_sku from products where id = v_prod;
    end if;
    v_qty := v_qty + v_iqty;
    v_amt := v_amt + coalesce(v_unit,0)*v_iqty;
    insert into stock_adjustments(product_id, variant_id, sku, delta, kind, source, reason, ref_id, created_at)
      values (v_prod, v_variant, v_sku, v_iqty, 'return', 'Sales return', coalesce(nullif(p_reason,''),'Returned'), p_order_id, now());
  end loop;
  insert into returns(id, kind, ref_order_id, reason, qty, created_at) values (v_id, 'sales', p_order_id, p_reason, v_qty, now());
  select coalesce(max(balance),0) into v_bal from ledger;
  insert into ledger(kind, ref_id, debit, credit, balance, note, created_at) values('sales', v_id, v_amt, 0, v_bal - v_amt, concat('Sales return: ', p_reason), now());
  insert into audit_log(actor, action, ref, detail) values('staff','sales_return', v_id::text, p_reason);
  return jsonb_build_object('return_id', v_id, 'qty', v_qty, 'amount', v_amt);
end; $function$;

-- 2) Read-only VALIDATION views — surface accounting/inventory inconsistencies automatically.
create or replace view public.v_inventory_reconciliation as
with mv as (select product_id, coalesce(sum(delta),0) as moved from stock_adjustments group by product_id)
select p.id as product_id, p.sku, p.name, p.qty as on_hand,
       coalesce(mv.moved,0) as movement_sum, p.qty - coalesce(mv.moved,0) as drift
from products p left join mv on mv.product_id = p.id
where p.qty <> coalesce(mv.moved,0);

create or replace view public.v_overpaid_orders as
select id, invoice_no, customer_name, total, amount_paid, amount_paid - total as overpaid
from orders where coalesce(amount_paid,0) > coalesce(total,0);

create or replace view public.v_accounting_health as
select
  (select count(*) from v_inventory_reconciliation) as inventory_drift_products,
  (select count(*) from v_overpaid_orders) as overpaid_orders,
  (select count(*) from products where coalesce(qty,0) < 0) as negative_stock,
  (select count(*) from stock_adjustments where ref_id is null and kind in ('sale','purchase','return','estimate')) as movements_without_source,
  (select coalesce(sum(greatest(0, total-amount_paid)),0) from orders where status not in ('cancelled','void')) as receivable_paise,
  (select coalesce(sum(p.total),0) - coalesce((select sum(amount) from supplier_payments),0) from purchases p) as payable_paise;

-- 3) One-time reconciliation: post an 'audit' movement wherever stock was added historically
--    without a movement record, so the ledger sums to physical on-hand. Stock is NOT changed.
insert into stock_adjustments(product_id, sku, delta, kind, source, reason, created_by, created_at)
select product_id, sku, drift, 'audit', 'Opening reconciliation',
       'Auto-reconciled stock ledger to physical on-hand (accounting audit)', 'system', now()
from public.v_inventory_reconciliation where drift <> 0;

-- 4) Guard: recorded payment can never exceed the bill total (change is not revenue).
update orders set amount_paid = total, pay_cash = least(coalesce(pay_cash,0), total)
where coalesce(amount_paid,0) > coalesce(total,0);

create or replace function public.cap_amount_paid() returns trigger language plpgsql as $$
begin
  if new.total is not null and coalesce(new.amount_paid,0) > new.total then
    new.amount_paid := new.total;
  end if;
  return new;
end; $$;
drop trigger if exists trg_cap_amount_paid on orders;
create trigger trg_cap_amount_paid before insert or update on orders
  for each row execute function public.cap_amount_paid();
