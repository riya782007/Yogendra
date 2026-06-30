-- Meeting 2 §1 (POS) — owner-managed bank / payment methods.
-- The owner adds the banks / UPI handles they collect into; at billing the cashier marks which
-- one received the money (orders.payment_method), and Bank & Cash breaks the bank total down per
-- method. Cash stays implicit. Idempotent — safe to re-run.

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'bank',   -- 'bank' | 'upi' | 'wallet'
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

-- Which bank/UPI method received the non-cash portion of a sale (null = cash-only / unassigned).
alter table public.orders add column if not exists payment_method text;
