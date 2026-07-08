-- Full promotions engine: placement type, scheduling window, overlay copy, CTA + discount code.
alter table public.promotions add column if not exists placement text not null default 'hero';   -- hero | popup | strip
alter table public.promotions add column if not exists starts_at timestamptz;                    -- null = live now
alter table public.promotions add column if not exists ends_at timestamptz;                      -- null = no end
alter table public.promotions add column if not exists headline text;                            -- popup/strip big line
alter table public.promotions add column if not exists subtext text;                             -- popup small line
alter table public.promotions add column if not exists cta_label text;                           -- button text
alter table public.promotions add column if not exists discount_code text;                       -- optional coupon shown
create index if not exists idx_promotions_live on public.promotions (status, placement, starts_at, ends_at);
