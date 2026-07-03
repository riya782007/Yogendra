-- Blythe Diva — 0038: per-line ORIGINAL rate on order_items.
--
-- Stores the pre-discount unit rate (paise) for a bill line, so the invoice / cash memo can show
-- Rate (original) → Discount → Amount (net). Null means "no discount" (original = unit_price).
-- Idempotent.
alter table public.order_items add column if not exists unit_mrp bigint;
