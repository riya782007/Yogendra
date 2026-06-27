-- Phase 7a (#9/#31): owner-defined labels attachable to any product/SKU.
create table if not exists public.labels (
  id uuid primary key default extensions.uuid_generate_v4(),
  name text not null unique,
  color text not null default 'emerald',
  sort int not null default 0,
  created_at timestamptz default now()
);
create table if not exists public.product_labels (
  product_id uuid not null references public.products(id) on delete cascade,
  label_id uuid not null references public.labels(id) on delete cascade,
  primary key (product_id, label_id)
);
alter table public.labels enable row level security;
alter table public.product_labels enable row level security;
drop policy if exists labels_read on public.labels;
create policy labels_read on public.labels for select using (true);
drop policy if exists product_labels_read on public.product_labels;
create policy product_labels_read on public.product_labels for select using (true);
