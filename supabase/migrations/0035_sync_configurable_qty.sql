-- Blythe Diva — 0035: keep configurable-product stock in sync with its variants.
--
-- A configurable (colours) product holds stock per VARIANT; the product row's qty is just the sum.
-- An old Basic-tab edit could overwrite that total with a manual number, desyncing it from the real
-- per-colour stock. The app now derives it (updateProduct recomputes from variants; stock.ts rolls
-- up on every movement). This one-time sync corrects any historical drift. Safe + idempotent.
update products p
set qty = coalesce((select sum(v.qty) from variants v where v.product_id = p.id), 0)
where p.type = 'configurable';
