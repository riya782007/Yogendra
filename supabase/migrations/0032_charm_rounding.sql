-- Blythe Diva — 0032: charm rounding on the final displayed/charged prices.
--
-- Owner's rule: after the build-up formula runs, the RETAIL selling price must end in 9
-- (₹126 → ₹129) and the printed MRP must be a round multiple of 5 (ends in 0/5). This mirrors
-- the JS engine in lib/pricing.ts (roundRetailCharmPaise / roundMrpTo5Paise) EXACTLY, so that
-- online order placement (place_order) and POS estimates (create_estimate) — which price through
-- bd_price() in the DB — record the same totals the storefront shows. Values are integer paise.
--
-- ADDITIVE + IDEMPOTENT: CREATE OR REPLACE only; no data change.
CREATE OR REPLACE FUNCTION public.bd_price(p_base integer, p_tier text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
AS $function$
declare ps record; v_round int;
        shipped numeric; landed numeric; withreseller numeric; retail_raw numeric; mrp_raw numeric;
        wholesale_out numeric; retail_out numeric; mrp_out numeric;
        ret_rupees int; bump int; mrp_rupees int; floor_rupees int;
begin
  select * into ps from pricing_settings limit 1;
  v_round := coalesce(ps.round_to, 100);

  if coalesce(ps.use_buildup, false) then
    shipped       := p_base::numeric * (1 + coalesce(ps.shipping_pct, 0) / 100);
    landed        := shipped + coalesce(ps.packing_flat, 0) + coalesce(ps.promotion_flat, 0);
    withreseller  := landed * (1 + coalesce(ps.reseller_pct, 0) / 100);
    retail_raw    := withreseller * (1 + coalesce(ps.customer_discount_pct, 0) / 100);
    mrp_raw       := retail_raw * (1 + coalesce(ps.mrp_pct, 0) / 100);
    wholesale_out := round(p_base::numeric / v_round) * v_round;
  else
    wholesale_out := round((p_base::numeric * (1 + coalesce(ps.wholesale_markup_pct, 10) / 100)) / v_round) * v_round;
    retail_raw    := p_base::numeric * coalesce(ps.retail_multiplier, 2.2);
    mrp_raw       := p_base::numeric * coalesce(ps.mrp_multiplier, 2.75);
  end if;

  -- RETAIL: charm-round UP to the next whole rupee ending in 9 (paise in / paise out).
  ret_rupees := greatest(1, round(retail_raw / 100.0)::int);
  bump       := ((9 - (ret_rupees % 10)) + 10) % 10;
  retail_out := (ret_rupees + bump) * 100;

  -- MRP: nearest whole rupee ending in 0/5, never printed below the retail selling price.
  mrp_rupees := round(mrp_raw / 100.0 / 5.0)::int * 5;
  if mrp_rupees <= 0 then mrp_rupees := 5; end if;
  mrp_out := mrp_rupees * 100;
  if mrp_out < retail_out then
    floor_rupees := ceil(retail_out / 100.0)::int;
    mrp_out := (ceil(floor_rupees / 5.0)::int * 5) * 100;
  end if;

  return (case p_tier
            when 'wholesale' then wholesale_out
            when 'mrp' then mrp_out
            else retail_out end)::int;
end; $function$;
