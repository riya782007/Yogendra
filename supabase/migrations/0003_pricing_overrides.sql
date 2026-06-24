-- Blythe Diva — 0003: Explicit per-product & per-variant price overrides (Phase 4).
--
-- ADDITIVE + IDEMPOTENT. Safe to run after 0001/0002.
--
-- The formula (pricing_settings) stays the DEFAULT for every product. These nullable
-- columns let the owner pin an exact MRP / Retail / Wholesale price when they don't
-- want the formula's number. All values are integer PAISE. NULL = "inherit".
--
-- Resolution order at read time (see lib/pricing.ts resolvePrices):
--     variant override  →  product override  →  formula default
--
-- So a product can have a fixed retail price while a specific colour variant has its
-- own MRP, and everything else still flows from the single formula.

alter table products add column if not exists wholesale_override integer;  -- paise, null = formula
alter table products add column if not exists retail_override    integer;  -- paise, null = formula
alter table products add column if not exists mrp_override        integer;  -- paise, null = formula

alter table variants add column if not exists wholesale_override integer;   -- paise, null = inherit product/formula
alter table variants add column if not exists retail_override    integer;
alter table variants add column if not exists mrp_override        integer;

-- Guard against nonsensical negative overrides (NULL still allowed = inherit).
do $$ begin
  alter table products add constraint products_overrides_nonneg
    check (
      (wholesale_override is null or wholesale_override >= 0) and
      (retail_override    is null or retail_override    >= 0) and
      (mrp_override        is null or mrp_override        >= 0)
    );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table variants add constraint variants_overrides_nonneg
    check (
      (wholesale_override is null or wholesale_override >= 0) and
      (retail_override    is null or retail_override    >= 0) and
      (mrp_override        is null or mrp_override        >= 0)
    );
exception when duplicate_object then null; end $$;
