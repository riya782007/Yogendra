-- PERMANENT INTEGRITY GUARD. One place to prove the promise "every SKU's stock equals its movement log
-- and is never negative". Any row returned by this view is a problem to look at; an empty view = healthy.
-- Query anytime:  select * from stock_integrity;
create or replace view public.stock_integrity as
  select 'variant'::text as level, v.id as id, upper(v.sku) as sku, v.product_id,
         v.qty as stock, coalesce((select sum(sa.delta) from stock_adjustments sa where sa.variant_id = v.id),0) as ledger,
         v.qty - coalesce((select sum(sa.delta) from stock_adjustments sa where sa.variant_id = v.id),0) as drift
  from variants v
  where v.qty <> coalesce((select sum(sa.delta) from stock_adjustments sa where sa.variant_id = v.id),0)
     or v.qty < 0
  union all
  select 'product'::text, p.id, upper(p.sku), p.id,
         p.qty, coalesce((select sum(sa.delta) from stock_adjustments sa where sa.product_id = p.id and sa.variant_id is null),0),
         p.qty - coalesce((select sum(sa.delta) from stock_adjustments sa where sa.product_id = p.id and sa.variant_id is null),0)
  from products p
  where not exists (select 1 from variants v where v.product_id = p.id)
    and ( p.qty <> coalesce((select sum(sa.delta) from stock_adjustments sa where sa.product_id = p.id and sa.variant_id is null),0)
          or p.qty < 0 );
