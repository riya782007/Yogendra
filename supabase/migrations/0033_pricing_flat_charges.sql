-- 0033_pricing_flat_charges.sql
-- Packing & Promotion in the pricing build-up become FLAT ₹ charges (stored in paise) instead of
-- percentages. Retail now rounds to prices ending in 9, MRP to the nearest 5 (handled in code).
-- Idempotent.
begin;
alter table public.pricing_settings add column if not exists packing_flat   integer not null default 2500; -- ₹25
alter table public.pricing_settings add column if not exists promotion_flat integer not null default 2500; -- ₹25
commit;
