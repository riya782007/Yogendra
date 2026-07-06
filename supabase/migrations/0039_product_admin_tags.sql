-- Blythe Diva — 0039: per-product internal admin tags/notes.
--
-- The owner keeps his own short status tags on a product (e.g. "inventory updated",
-- "variant images sorted"). Admin-only — shown in the Catalogue and on any product's admin
-- page, NEVER on the storefront. Idempotent.
alter table public.products add column if not exists admin_tags text[] not null default '{}';
