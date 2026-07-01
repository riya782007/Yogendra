-- Blythe Diva — 0033: make the DB pricing function agree with the app (cost = wholesale price).
--
-- Bug: bd_price() (used by place_order / place_wholesale_order / create_estimate) still built the
-- wholesale rate UP from the entered cost through shipping/packing/promotion/reseller, so a ₹200
-- entry billed ₹310 wholesale — while the app (lib/pricing computePrices) now treats the entered
-- value AS the wholesale price (₹200). The storefront showed ₹200 but orders charged ₹310.
--
-- Fix: in the % build-up mode, WHOLESALE = the entered base (the owner's rule "the cost is the
-- wholesale price"). Retail = wholesale + customer-step % (rounded to end in ₹9). MRP = retail +
-- markup % (rounded to nearest ₹5). This mirrors lib/pricing.ts exactly, so screen == invoice.
-- The old multiplier mode (build-up OFF) is unchanged. Idempotent (CREATE OR REPLACE).

create or replace function public.bd_price(p_base integer, p_tier text)
returns integer
language plpgsql
stable
as $function$
declare
  ps record;
  v_round int;
  v_w numeric; v_r numeric; v_m numeric; v_out numeric;
  retail_raw numeric;  -- paise, unrounded retail
  mrp_raw numeric;     -- paise, unrounded mrp
begin
  select * into ps from pricing_settings limit 1;
  v_round := coalesce(ps.round_to, 100);

  if coalesce(ps.use_buildup, false) then
    -- The entered base IS the wholesale price (cost = wholesale).
    retail_raw := p_base::numeric * (1 + coalesce(ps.customer_discount_pct,0)/100);
    mrp_raw    := retail_raw      * (1 + coalesce(ps.mrp_pct,0)/100);
    v_w := round(p_base::numeric / v_round) * v_round;                       -- nearest ₹1
    v_r := greatest(9, round((retail_raw/100 - 9)/10) * 10 + 9) * 100;       -- ends in ₹9
    v_m := greatest(5, round((mrp_raw/100) / 5) * 5) * 100;                  -- nearest ₹5
    v_out := case p_tier when 'wholesale' then v_w when 'mrp' then v_m else v_r end;
    return v_out::int;
  else
    v_w := p_base * (1 + coalesce(ps.wholesale_markup_pct,10)/100);
    v_r := p_base * coalesce(ps.retail_multiplier,2.2);
    v_m := p_base * coalesce(ps.mrp_multiplier,2.75);
    v_out := case p_tier when 'wholesale' then v_w when 'mrp' then v_m else v_r end;
    return (round(v_out / v_round) * v_round)::int;
  end if;
end; $function$;
