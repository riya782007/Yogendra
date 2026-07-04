-- Blythe Diva — 0036: AI promotional posters / festive campaigns.
--
-- The owner types a rough idea; OpenAI refines it into a detailed poster prompt (grounded in the
-- live catalogue + the festival/theme); Gemini (Nano Banana) generates the poster; publishing places
-- it in the storefront and/or wholesale hero, optionally targeted to a category's page.
create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  title text,
  prompt text,                         -- the owner's rough idea
  refined_prompt text,                 -- OpenAI-refined image-generation prompt
  image_path text,                     -- generated poster public URL
  target_category_id uuid references public.categories(id) on delete set null,
  cta_href text,                       -- where the banner links (defaults to the target category / shop)
  show_retail boolean not null default false,
  show_wholesale boolean not null default false,
  status text not null default 'draft',   -- draft | published | archived
  aspect text default '16:9',
  provider text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_promotions_status on public.promotions(status, created_at desc);
create index if not exists idx_promotions_target on public.promotions(target_category_id);
alter table public.promotions enable row level security;
