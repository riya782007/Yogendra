/**
 * lib/offers.ts — PURE realtime offer/discount math (no I/O).
 * The storefront shows MRP struck through, the retail sale price, and the live
 * "X% OFF" badge — all derived from the formula at render time (Req 3.4 / 4.2).
 */
import { resolvePrices, type PricingFormula, type PriceOverrides } from "./pricing";

export type Offer = {
  mrp: number;          // paise
  price: number;        // paise (retail sale price)
  savings: number;      // paise saved vs MRP
  offerPct: number;     // integer percent off
  hasOffer: boolean;
};

/** Derive the offer purely from MRP and sale price (paise). */
export function deriveOffer(mrpPaise: number, pricePaise: number): Offer {
  const mrp = Math.max(0, Math.round(mrpPaise));
  const price = Math.max(0, Math.round(pricePaise));
  const savings = Math.max(0, mrp - price);
  const offerPct = mrp > 0 ? Math.round((savings / mrp) * 100) : 0;
  return { mrp, price, savings, offerPct, hasOffer: savings > 0 };
}

/**
 * Compute the full live offer for a product from its base wholesale + formula.
 * Optionally pass override layers (highest priority first, e.g. variant then product)
 * so explicit retail/MRP overrides are reflected on the storefront. Backward compatible:
 * with no overrides this behaves exactly as before.
 */
export function liveOffer(
  baseWholesalePaise: number,
  formula: PricingFormula,
  ...overrides: (PriceOverrides | null | undefined)[]
): Offer {
  const { retailPrice, mrp } = resolvePrices(baseWholesalePaise, formula, ...overrides);
  return deriveOffer(mrp, retailPrice);
}
