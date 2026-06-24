-- Blythe Diva — 0005: RLS lockdown of sensitive tables (Phase 8, defense-in-depth).
--
-- ADDITIVE + IDEMPOTENT + SAFE.
--
-- Security model: the app reaches Supabase ONLY through the server using the
-- SERVICE-ROLE key (lib/supabase/server.ts), which BYPASSES Row Level Security.
-- The browser client (lib/supabase/browser.ts) is not imported anywhere. So no
-- legitimate request reads these tables with the anon/authenticated key.
--
-- Enabling RLS with NO policy therefore changes nothing for the app, but slams the
-- door on direct anon-key access to financial records, customer PII, role passcodes,
-- and the audit trail — closing the exact hole Supabase warned about for
-- stock_adjustments. RBAC itself is enforced in the server actions (requirePerm).
--
-- Storefront-public tables (products, categories, variants, product_images) keep
-- their existing public-read policies from 0001 and are intentionally NOT touched.

do $$
declare t text;
begin
  foreach t in array array[
    'orders','order_items','customers','retailers',
    'estimates','estimate_items','purchases','purchase_items','returns',
    'ledger','suppliers','approvals','audit_log','agent_runs','ai_calls',
    'roles','user_roles','contacts','assignments','notifications',
    'reviews','reels','reel_products','ga_events','gbp_state','stock_adjustments'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;
