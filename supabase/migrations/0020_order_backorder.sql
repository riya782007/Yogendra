-- Module — Backorder access.
-- When a POS sale is billed beyond available stock (the owner ticks "bill anyway as a
-- backorder"), flag the order so it surfaces on /admin/backorders. Stock itself stays
-- floored at 0 (migration 0015); this flag is how the owner finds what's owed/pending.
-- Idempotent: safe to re-run.

alter table public.orders
  add column if not exists is_backorder boolean not null default false;

-- Partial index so the backorders screen lists only flagged orders fast.
create index if not exists orders_is_backorder_idx
  on public.orders (created_at desc)
  where is_backorder;
