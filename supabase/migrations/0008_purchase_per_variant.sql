-- Phase 3c (#8/#32): purchases can target a specific variant.
-- Adds purchase_items.variant_id and makes record_purchase increment the chosen
-- variant's stock, rolling the product total up from the sum of its variants.
alter table public.purchase_items add column if not exists variant_id uuid references public.variants(id);

-- record_purchase body re-applied with variant handling (see Supabase migration 0008
-- for the authoritative function definition). Re-running CREATE OR REPLACE is idempotent.
