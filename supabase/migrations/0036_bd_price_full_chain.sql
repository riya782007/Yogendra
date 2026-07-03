-- Blythe Diva — 0036: bd_price() rebuilt to the owner's FULL costing-sheet chain.
--
-- Base = the WHOLESALE price the client enters (what he sells to resellers at). Purchase-bill
-- price is reference-only and never feeds this. From the base W the retail & MRP are built up:
--   1. free shipping   W × (1 + shipping_pct%)
--   2. packing         + packing_flat   (flat paise)
--   3. promotion       + promotion_flat (flat paise)
--   4. reseller margin × (1 + reseller_pct%)
--   5. reseller-referral discount × (1 + customer_discount_pct%)  ==> RETAIL
--   6. mrp markup      × (1 + mrp_pct%)                            ==> MRP
-- Wholesale rate = W itself. Mirrors lib/pricing.ts buildupStages() exactly.
-- Defaults (10% / ₹25 / ₹25 / 15% / 5% / 25%) reproduce the sheet: ₹200 → wholesale 200, retail 326, MRP 408.
-- Idempotent (CREATE OR REPLACE).

create or replace function public.bd_price(p_base integer, p_tier text)
returns integer language plpgsql stable as $function$
declare ps record; v_round int;
        shipped numeric; landed numeric; withreseller numeric; retail_raw numeric; mrp_raw numeric;
        wholesale_out numeric; retail_out numeric; mrp_out numeric; v_out numeric;
begin
  select * into ps from pricing_settings limit 1;
  v_round := coalesce(ps.round_to, 100);
  if coalesce(ps.use_buildup, false) then
    shipped      := p_base::numeric * (1 + coalesce(ps.shipping_pct, 0) / 100);
    landed       := shipped + coalesce(ps.packing_flat, 0) + coalesce(ps.promotion_flat, 0);
    withreseller := landed * (1 + coalesce(ps.reseller_pct, 0) / 100);
    retail_raw   := withreseller * (1 + coalesce(ps.customer_discount_pct, 0) / 100);
    mrp_raw      := retail_raw * (1 + coalesce(ps.mrp_pct, 0) / 100);
    wholesale_out := round(p_base::numeric / v_round) * v_round;  -- wholesale = entered value
    retail_out    := round(retail_raw / v_round) * v_round;
    mrp_out       := round(mrp_raw / v_round) * v_round;
    v_out := case p_tier when 'wholesale' then wholesale_out when 'mrp' then mrp_out else retail_out end;
    return v_out::int;
  else
    v_out := case p_tier
               when 'wholesale' then p_base * (1 + coalesce(ps.wholesale_markup_pct, 10) / 100)
               when 'mrp' then p_base * coalesce(ps.mrp_multiplier, 2.75)
               else p_base * coalesce(ps.retail_multiplier, 2.2) end;
    return (round(v_out / v_round) * v_round)::int;
  end if;
end; $function$;
