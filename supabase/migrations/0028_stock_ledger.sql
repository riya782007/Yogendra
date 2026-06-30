-- Blythe Diva — 0028: Product Stock Ledger support · ENRICHES the existing movement ledger.
--
-- ADDITIVE + IDEMPOTENT. No new movement table — the Product Stock Ledger is DERIVED from the
-- existing public.stock_adjustments rows (one row per inventory event). These columns just let
-- each movement carry its source document + actor, and give products an owner-set reorder point,
-- so the ledger header / audit / related-document links are complete.

-- Source-document reference (order / purchase / estimate id). Used by the "Related documents"
-- links. Guarded so it's a no-op if the deployed DB already added it.
alter table public.stock_adjustments add column if not exists ref_id     uuid;

-- Audit: who created the movement (POS cashier, owner, DIVA, bulk import…).
alter table public.stock_adjustments add column if not exists created_by text;

-- Owner-set reorder level per product (header shows it; NULL = not set).
alter table public.products add column if not exists reorder_level integer;

-- The ledger reads a single product's history in chronological order to compute running balances.
create index if not exists idx_stock_adj_product_created on public.stock_adjustments(product_id, created_at);
