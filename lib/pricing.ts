/**
 * lib/pricing.ts — PURE pricing engine (no I/O). Requirement 3.
 *
 * Money is handled in integer paise everywhere. One formula (PricingFormula)
 * drives the whole catalogue, so changing it re-prices every product (Req 3.2).
 *
 * Display rounding is applied via formula.roundToPaise (e.g. 100 = nearest ₹1).
 */

export type PricingFormula = {
  /** markup over base wholesale to reach the wholesale RATE sold to retailers, in % */
  wholesaleMarkupPct: number;
  /** multiplier on base wholesale to reach the retail selling price */
  retailMultiplier: number;
  /** multiplier on base wholesale to reach the printed MRP (>= retail) */
  mrpMultiplier: number;
  /** rounding granularity in paise applied to displayed prices (e.g. 100 => nearest rupee) */
  roundToPaise: number;
  /** Module 4 — when true, derive prices via the %-build-up chain instead of the multipliers. */
  useBuildup?: boolean;
  shippingPct?: number;
  packingPct?: number;
  promotionPct?: number;
  resellerPct?: number;
  customerDiscountPct?: number;
  mrpPct?: number;
};

export type PriceSet = {
  /** rate charged to wholesale buyers, in paise */
  wholesaleRate: number;
  /** retail selling price, in paise */
  retailPrice: number;
  /** printed MRP, in paise */
  mrp: number;
};

export const DEFAULT_FORMULA: PricingFormula = {
  wholesaleMarkupPct: 10,
  retailMultiplier: 2.2,
  mrpMultiplier: 2.75,
  roundToPaise: 100,
};

function roundToNearest(valuePaise: number, stepPaise: number): number {
  if (!stepPaise || stepPaise <= 0) return Math.round(valuePaise);
  return Math.round(valuePaise / stepPaise) * stepPaise;
}

/**
 * Compute the full price set from a base wholesale cost (in paise) and a formula.
 * Pure and deterministic. Does NOT throw — invalid inputs yield a set that
 * isValidPriceSet() will reject, so callers can flag & exclude from publish (Req 3.5).
 */
export function computePrices(baseWholesalePaise: number, formula: PricingFormula): PriceSet {
  const base = Number.isFinite(baseWholesalePaise) ? baseWholesalePaise : NaN;

  // Module 4 — %-build-up chain (mirrors the DB `bd_price()` exactly):
  // cost → +shipping% → +packing% → +promotion% (landed) → +reseller% (wholesale)
  //      → +customer_discount% (retail) → +mrp% (MRP).
  if (formula.useBuildup) {
    const p = (n?: number) => 1 + (Number(n) || 0) / 100;
    const landed = base * p(formula.shippingPct) * p(formula.packingPct) * p(formula.promotionPct);
    const wholesale = landed * p(formula.resellerPct);
    const retail = wholesale * p(formula.customerDiscountPct);
    const printedMrp = retail * p(formula.mrpPct);
    return {
      wholesaleRate: roundToNearest(wholesale, formula.roundToPaise),
      retailPrice: roundToNearest(retail, formula.roundToPaise),
      mrp: roundToNearest(printedMrp, formula.roundToPaise),
    };
  }

  const wholesaleRate = roundToNearest(base * (1 + formula.wholesaleMarkupPct / 100), formula.roundToPaise);
  const retailPrice = roundToNearest(base * formula.retailMultiplier, formula.roundToPaise);
  const mrp = roundToNearest(base * formula.mrpMultiplier, formula.roundToPaise);

  return { wholesaleRate, retailPrice, mrp };
}

/**
 * Step-by-step build-up breakdown for the pricing settings preview (display-only).
 * Returns each stage's running value in paise so the owner can see his sheet reproduced.
 */
export function buildupBreakdown(baseWholesalePaise: number, formula: PricingFormula) {
  const base = Number.isFinite(baseWholesalePaise) ? baseWholesalePaise : 0;
  const p = (n?: number) => 1 + (Number(n) || 0) / 100;
  const afterShipping = base * p(formula.shippingPct);
  const afterPacking = afterShipping * p(formula.packingPct);
  const afterPromotion = afterPacking * p(formula.promotionPct);
  const wholesale = afterPromotion * p(formula.resellerPct);
  const retail = wholesale * p(formula.customerDiscountPct);
  const mrp = retail * p(formula.mrpPct);
  return { base, afterShipping, afterPacking, afterPromotion, wholesale, retail, mrp };
}

/**
 * Validate a computed price set (Req 3.5). A set is valid only when:
 *  - all three values are finite, positive integers (paise)
 *  - retail does not exceed MRP (you never sell above the printed MRP)
 *  - wholesale rate is below retail (retailers must get a better price than shoppers)
 */
export function isValidPriceSet(p: PriceSet): boolean {
  const ok = (n: number) => Number.isFinite(n) && n > 0;
  if (!ok(p.wholesaleRate) || !ok(p.retailPrice) || !ok(p.mrp)) return false;
  if (p.retailPrice > p.mrp) return false;
  if (p.wholesaleRate >= p.retailPrice) return false;
  return true;
}

/** Convenience: compute + validate in one call. */
export function priceProduct(baseWholesalePaise: number, formula: PricingFormula) {
  const prices = computePrices(baseWholesalePaise, formula);
  return { prices, valid: isValidPriceSet(prices) };
}

// ---------------------------------------------------------------------------
// Phase 4 — explicit per-product / per-variant overrides.
//
// The formula stays the default; these let the owner pin an exact tier price.
// All values are paise. `null`/`undefined` for a tier means "inherit".
// ---------------------------------------------------------------------------

export type PriceTier = "wholesale" | "retail" | "mrp";

export type PriceOverrides = {
  wholesale?: number | null; // paise
  retail?: number | null;    // paise
  mrp?: number | null;       // paise
};

/** Pull a PriceOverrides out of a DB row (products/variants) with *_override columns. */
export function overridesOf(
  row: { wholesale_override?: number | null; retail_override?: number | null; mrp_override?: number | null } | null | undefined,
): PriceOverrides {
  return {
    wholesale: row?.wholesale_override ?? null,
 