-- Phase 4b:
--  #1  products.wholesale_only — hidden from the D2C storefront/catalog, shown to retailers.
--  #27 place_wholesale_order enforces a ₹3,000 minimum (raises if the order is below it).
alter table public.products add column if not exists wholesale_only boolean not null default false;

-- place_wholesale_order re-applied with the ₹3,000 minimum check (authoritative body in
-- Supabase migration 0010). Re-running CREATE OR REPLACE is idempotent.
