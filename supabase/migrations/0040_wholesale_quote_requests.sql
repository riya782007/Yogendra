-- RFQ: dealers can request a quote for bulk / custom orders. Owner is notified on WhatsApp.
create table if not exists public.wholesale_quote_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  dealer_name text,
  dealer_phone text,
  details text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists idx_wqr_status_created on public.wholesale_quote_requests (status, created_at desc);
alter table public.wholesale_quote_requests enable row level security;
-- Service-role only (server actions use the service client); no public policies.
