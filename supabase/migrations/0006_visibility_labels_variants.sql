-- Blythe Diva — 0006: wholesale-only visibility, SKU labels, variant size/polish.
--
-- ADDITIVE + IDEMPOTENT. Safe to run after 0001–0005.
--
-- Req 1: some products are wholesale-only and must NOT show to retail/public shoppers.
-- Req 9: free-form labels/tags on a SKU (e.g. "Bridal", "Bestseller", "New").
-- Req 7: variants are configured by colour AND size AND polish (not colour alone).

alter table products add column if not exists visibility text not null default 'all';  -- 'all' | 'wholesale'
alter table products add column if not exists labels text[] not null default '{}';
do $$ begin
  alter table products add constraint products_visibility_chk check (visibility in ('all','wholesale'));
exception when duplicate_object then null; end $$;
create index if not exists idx_products_visibility on products(visibility);

alter table variants add column if not exists size text;
alter table variants add column if not exists polish text;
