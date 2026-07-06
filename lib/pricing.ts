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
  /** flat packing charge in PAISE (owner bills packing as a ₹ amount, not a %). */
  packingFlat?: number;
  /** flat promotion / marketing charge in PAISE. */
  promotionFlat?: number;
  packingPct?: number;    // legacy — build-up now adds packingFlat instead
  promotionPct?: number;  // legacy — build-up now adds promotionFlat instead
  resellerPct?: number;
  customerDiscountPct?: number;
  mrpPct?: number;
  /** Minimum wholesale order value in paise (gate on the wholesale cart). */
  wholesaleMinOrder?: number;
  /** Global quantity-break tiers: buy N+ of a line → % off that line's wholesale rate. */
  wholesaleTiers?: WholesaleTier[];
};

/** A single global quantity break, e.g. { minQty: 12, pctOff: 5 } = 12+ pcs get 5% off. */
export type WholesaleTier = { minQty: number; pctOff: number };

/**
 * Best (highest) % off a given line quantity qualifies for, across all tiers.
 * Pure + shared by the storefront display and mirrored by the DB RPC that records the order.
 */
export function tierPctOff(tiers: WholesaleTier[] | undefined, qty: number): number {
  if (!tiers?.length || qty <= 0) return 0;
  let pct = 0;
  for (const t of tiers) {
    const min = Number(t?.minQty);
    const off = Number(t?.pctOff);
    if (Number.isFinite(min) && Number.isFinite(off) && qty >= min && off > pct) pct = off;
  }
  return Math.max(0, Math.min(100, pct));
}

/** Apply a tier % to a unit price (paise), rounded to the nearest paise — matches the RPC. */
export function applyTier(unitPaise: number, pctOff: number): number {
  if (!pctOff) return unitPaise;
  return Math.max(0, Math.round(unitPaise * (1 - pctOff / 100)));
}

/** Normalise/sort tiers ascending by minQty, dropping invalid rows. */
export function cleanTiers(raw: unknown): WholesaleTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => ({ minQty: Math.floor(Number(r?.minQty ?? r?.min_qty)), pctOff: Number(r?.pctOff ?? r?.pct_off) }))
    .filter((t) => Number.isFinite(t.minQty) && t.minQty >= 1 && Number.isFinite(t.pctOff) && t.pctOff > 0 && t.pctOff <= 100)
    .sort((a, b) => a.minQty - b.minQty);
}

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
 * Charm-round a RETAIL selling price (paise) UP to the next whole rupee ending in 9.
 * The owner's rule: the final retail price must end in 9 (₹126 → ₹129, ₹130 → ₹139).
 * We round UP (never down) so the charm price never dips below the formula's output and
 * margin is protected. A value already ending in 9 is left as-is.
 */
export function roundRetailCharmPaise(valuePaise: number): number {
  if (!Number.isFinite(valuePaise) || valuePaise <= 0) return valuePaise;
  const rupees = Math.max(1, Math.round(valuePaise / 100));
  const bumpToNine = ((9 - (rupees % 10)) + 10) % 10; // smallest add so it ends in 9
  return (rupees + bumpToNine) * 100;
}

/**
 * Round a printed MRP (paise) to the nearest whole rupee ending in 0 or 5 (a multiple of 5).
 * If a retail floor is given, the MRP is never printed below the selling price — it is bumped
 * up to the next multiple of 5 at or above retail (keeps MRP ≥ retail, so the strike-through
 * price always looks right and passes validation).
 */
export function roundMrpTo5Paise(valuePaise: number, retailFloorPaise?: number): number {
  if (!Number.isFinite(valuePaise) || valuePaise <= 0) return valuePaise;
  let rupees = Math.round(valuePaise / 100 / 5) * 5;
  if (rupees <= 0) rupees = 5;
  let out = rupees * 100;
  if (typeof retailFloorPaise === "number" && Number.isFinite(retailFloorPaise) && out < retailFloorPaise) {
    const floorRupees = Math.ceil(retailFloorPaise / 100);
    out = Math.ceil(floorRupees / 5) * 5 * 100; // next multiple of 5 ≥ retail
  }
  return out;
}

/**
 * The pricing build-up, in paise, following the owner's costing sheet EXACTLY.
 * Starting from the base WHOLESALE price (W = what the client sells to resellers at):
 *   1. free shipping   → W × (1 + shipping%)
 *   2. packing         → + packingFlat (a flat ₹ amount)
 *   3. promotion       → + promotionFlat (a flat ₹ amount)
 *   4. reseller margin → × (1 + reseller%)
 *   5. reseller-referral discount → × (1 + customer%)   ==> RETAIL (selling price)
 *   6. mrp markup      → × (1 + mrp%)                    ==> MRP (struck-through)
 * Wholesale rate = W itself (no markup — the entered value IS the reseller price).
 */
function buildupStages(base: number, formula: PricingFormula) {
  const p = (n?: number) => 1 + (Number(n) || 0) / 100;
  const wholesale = base;
  const afterShipping = base * p(formula.shippingPct);
  const afterPacking = afterShipping + (Number(formula.packingFlat) || 0);
  const afterPromotion = afterPacking + (Number(formula.promotionFlat) || 0);
  const afterReseller = afterPromotion * p(formula.resellerPct);
  const retail = afterReseller * p(formula.customerDiscountPct);
  const mrp = retail * p(formula.mrpPct);
  return { wholesale, afterShipping, afterPacking, afterPromotion, afterReseller, retail, mrp };
}

/**
 * Compute the full price set from a base wholesale cost (in paise) and a formula.
 * Pure and deterministic. Does NOT throw — invalid inputs yield a set that
 * isValidPriceSet() will reject, so callers can flag & exclude from publish (Req 3.5).
 */
export function computePrices(baseWholesalePaise: number, formula: PricingFormula): PriceSet {
  const base = Number.isFinite(baseWholesalePaise) ? baseWholesalePaise : NaN;

  // Module 4 — %-build-up chain (mirrors the DB `bd_price()` and the costing sheet exactly).
  // Final display rule (owner's request): RETAIL always ends in 9, MRP always ends in 0/5.
  if (formula.useBuildup) {
    const s = buildupStages(base, formula);
    const retailPrice = roundRetailCharmPaise(s.retail);
    return {
      wholesaleRate: roundToNearest(s.wholesale, formula.roundToPaise),
      retailPrice,
      mrp: roundMrpTo5Paise(s.mrp, retailPrice),
    };
  }

  const wholesaleRate = roundToNearest(base * (1 + formula.wholesaleMarkupPct / 100), formula.roundToPaise);
  const retailPrice = roundRetailCharmPaise(base * formula.retailMultiplier);
  const mrp = roundMrpTo5Paise(base * formula.mrpMultiplier, retailPrice);

  return { wholesaleRate, retailPrice, mrp };
}

/**
 * Step-by-step build-up breakdown for the pricing settings preview (display-only).
 * Returns each stage's running value in paise so the owner sees his sheet reproduced.
 */
export function buildupBreakdown(baseWholesalePaise: number, formula: PricingFormula) {
  const base = Number.isFinite(baseWholesalePaise) ? baseWholesalePaise : 0;
  const s = buildupStages(base, formula);
  const round = formula.roundToPaise;
  // Intermediate stages show the raw running total; the FINAL retail/mrp use the charm rounding
  // (retail → ends in 9, mrp → ends in 0/5) so the preview matches what the storefront prints.
  const retail = roundRetailCharmPaise(s.retail);
  return {
    base,
    wholesale: roundToNearest(s.wholesale, round),
    afterShipping: roundToNearest(s.afterShipping, round),
    afterPacking: roundToNearest(s.afterPacking, round),
    afterPromotion: roundToNearest(s.afterPromotion, round),
    afterReseller: roundToNearest(s.afterReseller, round),
    retail,
    mrp: roundMrpTo5Paise(s.mrp, retail),
  };
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
