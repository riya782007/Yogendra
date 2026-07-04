-- Blythe Diva — 0033: owner-chosen storefront cover image.
--
-- ADDITIVE + IDEMPOTENT. When set, products.thumbnail_path is the exact image URL the storefront
-- uses as the product's card thumbnail (and the leading gallery image), overriding the automatic
-- "first generated image" pick. The owner may choose ANY of the product's images — including a
-- specific colour/variant photo — from the Photo Studio. NULL = automatic (previous behaviour).
alter table public.products add column if not exists thumbnail_path text;
