-- Blythe Diva — 0037: per-bill GST mode (exclusive vs inclusive).
--
-- 'exclusive' = GST is added on top of the shown price (customer pays total + 3%).
-- 'inclusive' = the shown price already contains GST (customer pays exactly the total; the tax is
--               the portion inside it). Chosen at billing on the POS and stored per order; the
--               invoice/cash-memo renders the taxable value and grand total accordingly.
-- NULL is treated as 'exclusive' (the previous default), so existing bills are unaffected.
alter table public.orders add column if not exists gst_mode text;
