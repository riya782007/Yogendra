-- Real abandoned-cart capture: one row per browser session, upserted as the cart changes.
alter table public.abandoned_carts add column if not exists session_id text;
alter table public.abandoned_carts add column if not exists updated_at timestamptz not null default now();
create unique index if not exists uq_abandoned_carts_session on public.abandoned_carts (session_id) where session_id is not null;
