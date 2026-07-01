-- Blythe Diva — 0035: bd_price() — the WHOLESALE billing price IS the value entered (owner's rule).
--
-- Final rule confirmed by the owner: whatever price is entered on a product is the wholesale price
-- charged at billing — NOT a cost that gets built up. Retail = +customer% (ends ₹9),
-- MRP = +mrp% (nearest ₹5). Mirrors lib/pricing.ts (computePrices + buildupBreakdown) and the
-- Pricing-formula page preview, so the screen, storefront and invoice all agree.
-- Enter ₹200 → wholesale ₹200 · retail ₹209 · MRP ₹265. Idempotent (CREATE OR REPLACE).

create or replace function public.bd_price(p_base integer, p_tier text)
returns integer language plpgsql stable as $function$
declare ps record; v_round int; retail_raw numeric; mrp_raw numeric;
        wholesale_out numeric; retail_out numeric; mrp_out numeric; v_out numeric;
begin
  select * into ps from pricing_settings limit 1;
  v_round := coalesce(ps.round_to, 100);
  if coalesce(ps.use_buildup, false) then
    retail_raw := p_base::numeric * (1 + coalesce(ps.customer_discount_pct,0)/100);
    mrp_raw    := retail_raw      * (1 + coalesce(ps.mrp_pct,0)/100);
    wholesale_out := round(p_base::numeric / v_round) * v_round;              -- wholesale = entered value
    retail_out := greatest(9, round((retail_raw/100 - 9)/10) * 10 + 9) * 100; -- ends ₹9
    mrp_out    := greatest(5, round((mrp_raw/100) / 5) * 5) * 100;            -- nearest ₹5
    v_out := case p_tier when 'wholesale' then wholesale_out when 'mrp' then mrp_out else retail_out end;
    return v_out::int;
  else
    v_out := case p_tier
               when 'wholesale' then p_base * (1 + coalesce(ps.wholesale_markup_pct,10)/100)
               when 'mrp' then p_base * coalesce(ps.mrp_multiplier,2.75)
               else p_base * coalesce(ps.retail_multiplier,2.2) end;
    return (round(v_out / v_round) * v_round)::int;
  end if;
end; $function$;
