-- Meeting 2 §1 — extra billing charges: Packing / Courier / Adjustment.
-- These are GST-applicable, so they are folded into the document TOTAL (GST is computed on the
-- total) and itemised on the invoice. Stored in paise on both orders and estimates.
-- Adjustment may be negative (a round-off or concession). Idempotent — safe to re-run.

alter table public.orders     add column if not exists extra_packing    bigint not null default 0;
alter table public.orders     add column if not exists extra_courier    bigint not null default 0;
alter table public.orders     add column if not exists extra_adjustment bigint not null default 0;

alter table public.estimates  add column if not exists extra_packing    bigint not null default 0;
alter table public.estimates  add column if not exists extra_courier    bigint not null default 0;
alter table public.estimates  add column if not exists extra_adjustment bigint not null default 0;
