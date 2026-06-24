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

  const wholesaleRate = roundToNearest(base * (1 + formula.wholesaleMarkupPct / 100), formula.roundToPaise);
  const retailPrice = roundToNearest(base * formula.retailMultiplier, formula.roundToPaise);
  const mrp = roundToNearest(base * formula.mrpMultiplier, formula.roundToPaise);

  return { wholesaleRate, retailPrice, mrp };
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
    retail: row?.retail_override ?? null,
    mrp: row?.mrp_override ?? null,
  };
}

function firstPositive(...vals: (number | null | undefined)[]): number | undefined {
  for (const v of vals) if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return undefined;
}

/**
 * Resolve the effective price set, applying override layers in priority order
 * (highest priority first), falling back to the formula-computed value per tier.
 *
 *   resolvePrices(base, formula, variantOverrides, productOverrides)
 *
 * Each layer may set any subset of tiers; a tier with no override anywhere uses
 * the formula. Pure & deterministic.
 */
export function resolvePrices(
  baseWholesalePaise: number,
  formula: PricingFormula,
  ...layers: (PriceOverrides | null | undefined)[]
): PriceSet {
  const computed = computePrices(baseWholesalePaise, formula);
  return {
    wholesaleRate: firstPositive(...layers.map((l) => l?.wholesale)) ?? computed.wholesaleRate,
    retailPrice: firstPositive(...layers.map((l) => l?.retail)) ?? computed.retailPrice,
    mrp: firstPositive(...layers.map((l) => l?.mrp)) ?? computed.mrp,
  };
}

/** Read one tier out of a resolved price set. */
export function priceForTier(p: PriceSet, tier: PriceTier): number {
  return tier === "wholesale" ? p.wholesaleRate : tier === "retail" ? p.retailPrice : p.mrp;
}

/** Which tier a given customer type pays. Wholesale buyers → wholesale; everyone else → retail. */
export function tierForCustomer(customerType?: string | null): PriceTier {
  return customerType === "wholesale" ? "wholesale" : "retail";
}

/** Format paise as an Indian-rupee display string. Display-only. */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return "—";
  const rupees = paise / 100;
  return "₹" + rupees.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
