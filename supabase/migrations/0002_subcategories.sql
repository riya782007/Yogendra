-- Blythe Diva — 0002: Category hierarchy (subcategories) + product↔subcategory mapping.
--
-- ADDITIVE + IDEMPOTENT. Safe to run on the live DB after 0001. Adds:
--   • categories.parent_id      → self-referential hierarchy (future nesting)
--   • categories.sort           → manual ordering of parent categories
--   • subcategories             → named children of a parent category (the business
--                                 model: Necklaces → Oxidised, Kundan, Temple, …)
--   • products.subcategory_id   → a product's primary subcategory (fast filter)
--   • product_subcategory_map   → many-to-many so a product can sit in several
--                                 subcategories (the spec's "multiple subcategories")
--
-- Catalogue sharing then filters by category OR subcategory OR selected products,
-- e.g. share only "Oxidised Necklaces" without the rest of the necklace inventory.

-- 1) Extend categories with hierarchy + ordering ----------------------------------
alter table categories add column if not exists parent_id uuid references categories(id) on delete set null;
alter table categories add column if not exists sort integer not null default 0;
create index if not exists idx_categories_parent on categories(parent_id);

-- 2) Subcategories ----------------------------------------------------------------
create table if not exists subcategories (
  id uuid primary key default uuid_generate_v4(),
  category_id uuid references categories(id) on delete cascade,
  name text not null,
  slug text not null,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
-- slug is unique within a parent category (two parents may each have "Long").
create unique index if not exists uq_subcategories_cat_slug on subcategories(category_id, slug);
create index if not exists idx_subcategories_category on subcategories(category_id);

-- 3) Product primary subcategory (nullable; null = "uncategorised within parent") --
alter table products add column if not exists subcategory_id uuid references subcategories(id) on delete set null;
create index if not exists idx_products_subcategory on products(subcategory_id);

-- 4) Many-to-many: a product can belong to multiple subcategories ------------------
create table if not exists product_subcategory_map (
  product_id uuid not null references products(id) on delete cascade,
  subcategory_id uuid not null references subcategories(id) on delete cascade,
  primary key (product_id, subcategory_id)
);
create index if not exists idx_psm_subcategory on product_subcategory_map(subcategory_id);

-- 5) RLS — storefront may read subcategories + the map of published products -------
alter table subcategories enable row level security;
alter table product_subcategory_map enable row level security;
do $$ begin
  create policy "public reads subcategories" on subcategories for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "public reads psm of published" on product_subcategory_map
    for select using (exists (select 1 from products p where p.id = product_subcategory_map.product_id and p.status = 'published'));
exception when duplicate_object then null; end $$;

-- 6) Convenience: keep the primary subcategory in the M2M map automatically --------
create or replace function sync_primary_subcategory() returns trigger as $$
begin
  if new.subcategory_id is not null then
    insert into product_subcategory_map(product_id, subcategory_id)
    values (new.id, new.subcategory_id)
    on conflict do nothing;
  end if;
  return new;
end;
$$ language plpgsql;

do $$ begin
  create trigger trg_sync_primary_subcategory
    after insert or update of subcategory_id on products
    for each row execute function sync_primary_subcategory();
exception when duplicate_object then null; end $$;
