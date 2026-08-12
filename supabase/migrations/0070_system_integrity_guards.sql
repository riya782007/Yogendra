-- ESTABLISHED-RULE TRIPWIRES. These make the business rules impossible to violate silently: no matter
-- WHICH code path changes in future, any breach shows up here immediately. Empty views = every rule holds.
-- Check the whole system with one query:  select * from system_integrity;

drop view if exists public.system_integrity;
drop view if exists public.order_stock_integrity;

-- RULE (order stock): a cancelled/refunded order must have NET ZERO stock impact — whatever stock it took
-- must have returned (or it never took any). A non-zero net means a rejected order left stock wrong.
create view public.order_stock_integrity as
  select o.id as order_id, o.invoice_no, o.status::text as status, o.fulfillment,
         sum(sa.delta) as net_stock_delta, count(*) as movement_rows
  from orders o
  join stock_adjustments sa on sa.ref_id = o.id
  where o.status in ('cancelled','refunded')
  group by o.id, o.invoice_no, o.status, o.fulfillment
  having sum(sa.delta) <> 0;

-- ONE PLACE to prove the whole system is healthy. Any row = a rule is being violated; empty = all good.
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
  from order_stock_integrity;
