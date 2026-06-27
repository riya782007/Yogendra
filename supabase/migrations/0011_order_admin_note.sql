-- Phase 5a (#5/#34): internal note on an order/invoice — admin reference only,
-- never printed on the customer's copy.
alter table public.orders add column if not exists admin_note text;
