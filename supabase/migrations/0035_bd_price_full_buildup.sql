-- Blythe Diva — 0035: bd_price() full cost-sheet build-up (supersedes 0033).
--
-- Per the owner: the value entered on a product is the WHOLESALE base. The cost sheet builds up:
--   base +shipping% → +packing(flat ₹) → +promotion(flat ₹) = landed
--        → +reseller% = wholesale rate → +customer% = retail (ends ₹9) → +mrp% = MRP (nearest ₹5).
-- Mirrors lib/pricing.ts (computePrices + buildupBreakdown) and the Pricing-formula page preview,
-- so the screen, the storefront and the invoice all agree. Idempotent (CREATE OR REPLACE).

create or replace function public.bd_price(p_base integer, p_tier text)
returns integer language plpgsql stable as $function$
declare
  ps record; v_round int;
  v_land numeric; v_w numeric; retail_raw numeric; mrp_raw numeric;
  wholesale_out numeric; retail_out numeric; mrp_out numeric; v_out numeric;
begin
  select * into ps from pricing_settings limit 1;
  v_round := coalesce(ps.round_to, 100);
  if coalesce(ps.use_buildup, false) then
    v_land := p_base::numeric * (1 + coalesce(ps.shipping_pct,0)/100)
              + coalesce(ps.packing_flat,0) + coalesce(ps.promotion_flat,0);
    v_w := v_land * (1 + coalesce(ps.reseller_pct,0)/100);
    retail_raw := v_w * (1 + coalesce(ps.customer_discount_pct,0)/100);
    mrp_raw := retail_raw * (1 + coalesce(ps.mrp_pct,0)/100);
    wholesale_out := round(v_w / v_round) * v_round;
    retail_out := greatest(9, round((retail_raw/100 - 9)/10) * 10 + 9) * 100;
    mrp_out := greatest(5, round((mrp_raw/100) / 5) * 5) * 100;
    v_out := case p_tier when 'wholesale' then wholesale_out when 'mrp' then mrp_out else retail_out end;
    return v_out::int;
  else
    v_w := p_base * (1 + coalesce(ps.wholesale_markup_pct,10)/100);
    retail_raw := p_base * coalesce(ps.retail_multiplier,2.2);
    mrp_raw := p_base * coalesce(ps.mrp_multiplier,2.75);
    v_out := case p_tier when 'wholesale' then v_w when 'mrp' then mrp_raw else retail_raw end;
    return (round(v_out / v_round) * v_round)::int;
  end if;
end; $function$;
