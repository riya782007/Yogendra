-- Meeting 2 §4 — per-storefront product visibility.
-- `wholesale_only` already hides a product from the retail (D2C) shop. This adds the symmetric
-- `retail_only` to hide it from the wholesale portal. Visibility is now 3-way:
--   both (default · neither flag) / wholesale-only / retail-only.
-- Admin/POS still see every product; only the customer-facing wholesale store filters retail-only.
-- Idempotent — safe to re-run.

alter table public.products add column if not exists retail_only boolean not null default false;
