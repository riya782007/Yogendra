-- Blythe Diva — 0026: DB-level isolation of TRADE (wholesale/cost) pricing.
--
-- ADDITIVE + IDEMPOTENT + SAFE for the running app.
--
-- WHY THIS EXISTS
-- ----------------
-- `products` keeps a PUBLIC-READ RLS policy (0001) so the storefront, sitemap and crawlers
-- can read published catalogue rows with the anon key. RLS is ROW-level, not column-level —
-- so that same public policy also exposed the trade-cost columns (`base_wholesale` and the
-- per-product / per-variant override prices) to anyone holding the anon key + project URL.
-- That is exactly the wholesale-pricing leak the retail/dealer split must close.
--
-- The app itself never reads these tables with the anon key (it uses the SERVICE-ROLE key on
-- the server, which bypasses RLS and column grants), so removing anon/authenticated access to
-- the cost columns changes nothing for legitimate traffic — it only slams the door on direct
-- anon-key scraping of trade prices. Enforcement is server-side; no client-side filtering.
--
-- MECHANISM
-- ----------
-- A blanket table-level SELECT grant cannot be narrowed by a column-level REVOKE, so we drop
-- the blanket grant and re-grant SELECT on ONLY the non-sensitive columns. Future columns are
-- therefore private-by-default to public roles until explicitly granted — the safe direction.

do $$
begin
  -- ---- PRODUCTS ----------------------------------------------------------------------------
  revoke select on public.products from anon, authenticated;
  grant select (
    id, category_id, sku, name, type, qty, status,
    generated_content, embedding, last_movement_at, created_at,
    wholesale_only, retail_only
    -- intentionally NOT granted: base_wholesale, wholesale_override, retail_override, mrp_override
  ) on public.products to anon, authenticated;

  -- ---- VARIANTS ----------------------------------------------------------------------------
  revoke select on public.variants from anon, authenticated;
  grant select (
    id, product_id, color, sku, qty, image_paths, size, polish
    -- intentionally NOT granted: wholesale_override, retail_override, mrp_override
  ) on public.variants to anon, authenticated;
end $$;

-- ---- Re-assert RLS on the dealer-identity + order tables (already enabled in 0005) ----------
-- `customers` holds login_code + wholesale_approved (the dealer credential & approval flag);
-- orders/order_items hold trade order values. RLS-enabled with NO policy = deny-all to anon,
-- which is what we want: only the service-role server may read them.
do $$
declare t text;
begin
  foreach t in array array['customers','orders','order_items','retailers'] loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;
