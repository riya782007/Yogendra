-- Blythe Diva — 0029: Product Management System (PIM) · Phase 1 extension tables.
--
-- ADDITIVE + IDEMPOTENT + BACKWARD-COMPATIBLE.
--
-- We do NOT rebuild products/variants. The storefront + POS keep reading the existing columns
-- (name, sku, qty, status, base_wholesale, *_override, wholesale_only, retail_only). These new
-- tables hold the richer PIM attributes and the INDEPENDENT retail/wholesale settings; the save
-- actions keep products.wholesale_only / retail_only / status in sync from the channel settings,
-- so nothing downstream breaks.

-- 1) Per-product attribute sheet (1:1 with products) -------------------------------------------
create table if not exists public.product_details (
  product_id        uuid primary key references public.products(id) on delete cascade,
  product_code      text,
  internal_sku      text,
  collection        text,
  brand             text,
  vendor            text,
  supplier          text,
  short_description text,
  weight_grams      numeric,
  length_mm         numeric,
  width_mm          numeric,
  height_mm         numeric,
  material          text,
  occasion          text,
  gst_pct           numeric,
  hsn_code          text,
  country_of_origin text,
  -- richer lifecycle than the products.status enum (draft|published|archived|discontinued)
  lifecycle         text not null default 'draft',
  -- pricing extras (the base cost + overrides stay on products/variants)
  retail_discount_pct  numeric,
  moq                  integer,
  bulk_discount_pct    numeric,
  dealer_margin_pct    numeric,
  wholesale_tier       text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 2) Independent retail / wholesale storefront settings (one row per channel) -------------------
create table if not exists public.product_channel_settings (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  channel       text not null,                 -- 'retail' | 'wholesale'
  visible       boolean not null default true,
  featured      boolean not null default false,
  dealer_only   boolean not null default false, -- wholesale
  show_in_search      boolean not null default true,
  show_in_collections boolean not null default true,
  allow_reviews       boolean not null default true,
  allow_wishlist      boolean not null default true,
  show_price          boolean not null default true,
  show_discount       boolean not null default true,
  show_related        boolean not null default true,
  trade_price_visible boolean not null default true,  -- wholesale
  retail_price_hidden boolean not null default false, -- wholesale
  description    text,
  specifications text,
  trade_notes    text,        -- wholesale
  dealer_tags    text,        -- wholesale
  collections    text,        -- wholesale collections
  badges         text,        -- retail badges
  seo_title      text,
  meta_description text,
  url_slug       text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (product_id, channel)
);
create index if not exists idx_pcs_product on public.product_channel_settings(product_id);

-- 3) Per-variant independent visibility (hide one colour from retail, keep it for wholesale) ----
create table if not exists public.variant_channel_settings (
  id          uuid primary key default gen_random_uuid(),
  variant_id  uuid not null references public.variants(id) on delete cascade,
  channel     text not null,                   -- 'retail' | 'wholesale'
  visible     boolean not null default true,
  sort_order  integer,
  unique (variant_id, channel)
);
create index if not exists idx_vcs_variant on public.variant_channel_settings(variant_id);

-- 4) Inventory-tab fields on products (additive; qty + reorder_level already exist) -------------
alter table public.products add column if not exists min_stock            integer;
alter table public.products add column if not exists max_stock            integer;
alter table public.products add column if not exists warehouse            text;
alter table public.products add column if not exists barcode              text;
alter table public.products add column if not exists track_inventory      boolean not null default true;
alter table public.products add column if not exists continue_selling_oos boolean not null default false;
alter table public.products add column if not exists allow_backorders     boolean not null default false;

-- 5) RLS — service-role only, consistent with 0005 --------------------------------------------
alter table public.product_details          enable row level security;
alter table public.product_channel_settings enable row level security;
alter table public.variant_channel_settings enable row level security;

-- 6) Seed channel rows for existing products from current flags (one-time, idempotent) ---------
-- retail row: visible unless the product is wholesale_only; wholesale row: visible unless retail_only.
insert into public.product_channel_settings (product_id, channel, visible)
select p.id, 'retail', not coalesce(p.wholesale_only, false)
from public.products p
on conflict (product_id, channel) do nothing;

insert into public.product_channel_settings (product_id, channel, visible, dealer_only)
select p.id, 'wholesale', not coalesce(p.retail_only, false), false
from public.products p
on conflict (product_id, channel) do nothing;

-- seed a details row per product so the editor always has a record to update
insert into public.product_details (product_id, lifecycle)
select p.id, case when p.status = 'published' then 'published' else 'draft' end
from public.products p
on conflict (product_id) do nothing;
