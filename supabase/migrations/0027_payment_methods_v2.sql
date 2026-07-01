-- Blythe Diva — 0027: Centralized Payment Methods (single source of truth) · Phase 1.
--
-- ADDITIVE + IDEMPOTENT + BACKWARD-COMPATIBLE.
--
-- Extends the basic 0025 `payment_methods` into the master payment-method registry, adds a
-- normalized transaction ledger + a transfers table, and exposes per-method balances as a
-- drift-free VIEW (opening_balance + Σin − Σout). The legacy cash/bank model (orders.pay_cash /
-- pay_bank, doc_settings opening, cash_bank_summary) is left fully intact and kept in sync by the
-- app, so existing reports/dashboard never break. A one-time backfill seeds historical SALES into
-- the new ledger. Historical orders are NEVER modified.

-- 1) ENRICH payment_methods --------------------------------------------------------------------
-- `kind` (from 0025) is the Type: cash | bank | upi | wallet | card | cheque | razorpay | other.
-- `active`, `sort` (display order) and `created_at` already exist.
alter table public.payment_methods add column if not exists bank_name       text;
alter table public.payment_methods add column if not exists account_name    text;
alter table public.payment_methods add column if not exists account_number  text;
alter table public.payment_methods add column if not exists upi_id          text;
alter table public.payment_methods add column if not exists qr_code_url     text;
alter table public.payment_methods add column if not exists branch          text;
alter table public.payment_methods add column if not exists opening_balance bigint  not null default 0;  -- paise
alter table public.payment_methods add column if not exists archived        boolean not null default false;
alter table public.payment_methods add column if not exists is_default      boolean not null default false;
alter table public.payment_methods add column if not exists color           text;
alter table public.payment_methods add column if not exists icon            text;
alter table public.payment_methods add column if not exists notes           text;
alter table public.payment_methods add column if not exists created_by      text;

-- Seed an implicit Cash method (the default tender) if the registry has none.
insert into public.payment_methods (name, kind, sort, is_default, active)
select 'Cash', 'cash', 0, true, true
where not exists (select 1 from public.payment_methods where lower(kind) = 'cash');

-- 2) LEDGER — every money movement references exactly one method --------------------------------
create table if not exists public.payment_method_transactions (
  id          uuid primary key default gen_random_uuid(),
  method_id   uuid references public.payment_methods(id) on delete set null,
  txn_type    text not null,            -- sale | purchase | expense | transfer_in | transfer_out | refund | adjustment | opening
  direction   text not null,            -- in | out
  amount      bigint not null,          -- paise, always > 0 (direction carries the sign)
  ref_type    text,                     -- order | supplier_payment | transfer | manual | ...
  ref_id      uuid,
  note        text,
  occurred_at timestamptz not null default now(),
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pmt_method on public.payment_method_transactions(method_id, occurred_at);
create index if not exists idx_pmt_ref    on public.payment_method_transactions(ref_type, ref_id);

-- 3) TRANSFERS — internal account-to-account moves (schema ready; UI in Phase 2) ----------------
create table if not exists public.payment_method_transfers (
  id          uuid primary key default gen_random_uuid(),
  from_method uuid references public.payment_methods(id) on delete set null,
  to_method   uuid references public.payment_methods(id) on delete set null,
  amount      bigint not null,          -- paise
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);

-- 4) BALANCES — derived VIEW (no trigger drift; the single source of truth for current balance) -
create or replace view public.payment_method_balances as
select
  m.id   as method_id,
  m.name,
  m.kind,
  m.opening_balance,
  coalesce(sum(case when t.direction = 'in'  then t.amount else 0 end), 0) as total_in,
  coalesce(sum(case when t.direction = 'out' then t.amount else 0 end), 0) as total_out,
  m.opening_balance
    + coalesce(sum(case when t.direction = 'in'  then t.amount else 0 end), 0)
    - coalesce(sum(case when t.direction = 'out' then t.amount else 0 end), 0) as current_balance
from public.payment_methods m
left join public.payment_method_transactions t on t.method_id = m.id
group by m.id;

-- 5) RLS — service-role only, consistent with 0005 (deny-all to anon) ---------------------------
alter table public.payment_method_transactions enable row level security;
alter table public.payment_method_transfers   enable row level security;

-- 6) ONE-TIME BACKFILL of historical SALES into the ledger --------------------------------------
-- Cash portion of every past order → the Cash method; bank portion → the named method (matched by
-- name), else NULL (= Unassigned bank receipt). Guarded to run only once (ledger still empty).
do $$
declare cash_id uuid;
begin
  if exists (select 1 from public.payment_method_transactions limit 1) then
    return;  -- already backfilled
  end if;
  select id into cash_id from public.payment_methods where lower(kind) = 'cash' order by sort limit 1;

  insert into public.payment_method_transactions (method_id, txn_type, direction, amount, ref_type, ref_id, note, occurred_at)
  select cash_id, 'sale', 'in', o.pay_cash, 'order', o.id,
         coalesce(o.invoice_no, left(o.id::text, 8)), o.created_at
  from public.orders o
  where coalesce(o.pay_cash, 0) > 0;

  insert into public.payment_method_transactions (method_id, txn_type, direction, amount, ref_type, ref_id, note, occurred_at)
  select pm.id, 'sale', 'in', o.pay_bank, 'order', o.id,
         coalesce(o.invoice_no, left(o.id::text, 8)), o.created_at
  from public.orders o
  left join public.payment_methods pm on pm.name = o.payment_method
  where coalesce(o.pay_bank, 0) > 0;
end $$;
