-- Pillar 3 — explicit GST presentation mode per order.
--
-- Requirement: the TAX INVOICE should be GST-exclusive (rate is the pre-tax taxable value,
-- GST shown added on top), while the D2C storefront price stays inclusive of tax.
--
-- Until now the invoice inferred this only from the channel (wholesale = exclusive,
-- retail = inclusive). That left no way to issue a GST-exclusive tax invoice for a
-- retail/POS sale to a registered buyer. This column lets the owner pin it per bill:
--   NULL        → auto (wholesale = exclusive, retail/pos = inclusive) — existing behaviour
--   'exclusive' → GST added on top of the rate (taxable + GST = grand total)
--   'inclusive' → rate already includes GST (back-computed) — shelf-price behaviour
--
-- Idempotent + additive; no backfill so every existing order keeps its current (auto) look.

alter table public.orders add column if not exists gst_mode text;

do $$ begin
  alter table public.orders add constraint orders_gst_mode_chk
    check (gst_mode is null or gst_mode in ('inclusive','exclusive'));
exception when duplicate_object then null; end $$;
