-- Blythe Diva — 0030: AI Jewellery Photography Studio · generation ledger.
--
-- ADDITIVE + IDEMPOTENT + BACKWARD-COMPATIBLE.
--
-- The storefront keeps reading product_images (unchanged). This table records every AI
-- generation as an immutable CANDIDATE — so Regenerate NEVER overwrites: each click appends a
-- new version. Publishing a candidate copies its URL into product_images (the storefront source).

create table if not exists public.image_generations (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  variant_id    uuid references public.variants(id) on delete set null,
  raw_image_path text,                 -- the reference (raw) image used
  output_path   text,                  -- generated image public URL (null while pending/failed)
  shot_type     text not null default 'hero',  -- hero|closeup|lifestyle|side|angle45|back|detail|model|catalog_white|transparent|social_crop|enhance_*
  prompt        text,
  settings      jsonb not null default '{}'::jsonb,  -- lighting, model_style, background, focus, ethnicity, pose, lens, mood, luxury, emphasis…
  detected      jsonb,                 -- AI auto-detect: {category, material, style, attributes[]}
  provider      text,                  -- gemini:model | openai:model
  version       integer not null default 1,         -- per (product, shot_type)
  status        text not null default 'candidate',  -- candidate|favorite|published|rejected|archived
  created_by    text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_imggen_product on public.image_generations(product_id, shot_type, created_at desc);
create index if not exists idx_imggen_status  on public.image_generations(status);

-- Link a published storefront image back to the generation it came from + variant association.
alter table public.product_images add column if not exists variant_id    uuid references public.variants(id) on delete set null;
alter table public.product_images add column if not exists generation_id uuid references public.image_generations(id) on delete set null;
alter table public.product_images add column if not exists metadata      jsonb;

-- RLS — service-role only (consistent with 0005).
alter table public.image_generations enable row level security;
