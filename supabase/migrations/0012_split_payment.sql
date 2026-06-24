-- Phase 5c (#14/#37): split tender per bill — cash vs bank (UPI/card) — so cash-in-hand
-- and bank receipts are accountable. Dashboard sums these into a collections split.
alter table public.orders add column if not exists pay_cash integer not null default 0;
alter table public.orders add column if not exists pay_bank integer not null default 0;
