-- Blythe Diva — 0004: Inventory upgrades (Phase 6).
--
-- ADDITIVE + IDEMPOTENT. Safe to run after 0001–0003.
--
-- Adds variant-level + typed stock movements to the audit ledger:
--   • stock_adjustments.variant_id  → adjust a specific colour/size variant
--   • stock_adjustments.kind        → typed movement: purchase | sale | return |
--                                      damage | recount | correction | manual
--
-- (The table is created here defensively in case it was only made ad-hoc earlier.)

create table if not exists stock_adjustments (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references products(id) on delete cascade,
  sku text,
  delta integer not null,
  source text,
  reason text,
  created_at timestamptz not null default now()
);

alter table stock_adjustments add column if not exists variant_id uuid references variants(id) on delete set null;
alter table stock_adjustments add column if not exists kind text;

create index if not exists idx_stock_adj_product on stock_adjustments(product_id, created_at desc);
create index if not exists idx_stock_adj_variant on stock_adjustments(variant_id);
create index if not exists idx_stock_adj_kind on stock_adjustments(kind);
