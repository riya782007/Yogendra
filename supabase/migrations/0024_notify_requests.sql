-- Meeting 2 §7/§10 — "Notify Me" demand capture for out-of-stock products.
-- A storefront customer leaves their phone against an out-of-stock product; the owner sees the
-- pent-up demand (which product, who, how many) in Admin → Notify-Me. Idempotent.

create table if not exists public.notify_requests (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products(id) on delete set null,
  sku text,
  customer_name text,
  customer_phone text,
  created_at timestamptz not null default now()
);
create index if not exists notify_requests_sku_idx on public.notify_requests (sku);
create index if not exists notify_requests_created_idx on public.notify_requests (created_at desc);
