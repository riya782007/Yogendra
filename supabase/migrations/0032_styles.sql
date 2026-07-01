-- 0032_styles.sql
-- A second product taxonomy dimension: STYLE (e.g. Choker, Long Necklace, Round Neck Set),
-- separate from the "type" subcategory. Mainly used on Necklace / Earrings. A product carries one
-- primary style; the storefront & wholesale can then filter on TYPE (subcategory) + STYLE + colour.
-- Idempotent.

begin;

create table if not exists public.styles (
  id          uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories(id) on delete cascade,
  name        text not null,
  slug        text not null,
  sort        int  not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists styles_category_slug_uidx on public.styles (category_id, slug);

alter table public.products add column if not exists style_id uuid references public.styles(id) on delete set null;
create index if not exists products_style_id_idx on public.products (style_id);

commit;
