-- Phase 9 (#39): customer feedback captured from a public form, also sharable to WhatsApp.
create table if not exists public.feedback (
  id uuid primary key default extensions.uuid_generate_v4(),
  name text,
  phone text,
  rating int check (rating between 1 and 5),
  message text,
  order_ref text,
  created_at timestamptz default now(),
  seen boolean not null default false
);
alter table public.feedback enable row level security;
drop policy if exists feedback_insert on public.feedback;
create policy feedback_insert on public.feedback for insert with check (true);
