/**
 * Counter line pricing for the printed bill.
 *
 * Industry pattern (Square / Shopify POS / Clover): editing the line price IS the selling
 * rate — up or down. A discount is a separate field. Never treat a typed-down rate as
 * "catalogue minus discount", or a price increase is invisible and a bargain prints as Disc.
 */
export type PosLineForBill = {
  sku: string;
  qty: number;
  /** Amount the customer pays per piece (paise) — Rate after any Disc column. */
  billedPaise: number;
  /** Rate column on the POS (typed override, else catalogue). */
  ratePaise: number;
  /** True only when the Disc column / bill-level % was used. */
  hasExplicitDisc: boolean;
};

export function posItemPayload(l: PosLineForBill): {
  sku: string; qty: number; priceRupees: number; listRupees?: number;
} {
  const row: { sku: string; qty: number; priceRupees: number; listRupees?: number } = {
    sku: l.sku,
    qty: l.qty,
    priceRupees: l.billedPaise / 100,
  };
  if (l.hasExplicitDisc && l.ratePaise > l.billedPaise) {
    row.listRupees = l.ratePaise / 100;
  }
  return row;
}

/** How a stored order line should print: Rate is the selling price unless a real discount was stored. */
export function invoiceLineDisplay(it: { unit_price?: number | null; unit_mrp?: number | null }): {
  ratePaise: number;
  billedPaise: number;
  discPct: number;
  isDiscounted: boolean;
} {
  const billed = Math.max(0, it.unit_price ?? 0);
  const listed = it.unit_mrp != null && it.unit_mrp > billed ? it.unit_mrp : billed;
  const isDiscounted = listed > billed;
  const discPct = isDiscounted ? Math.round((1 - billed / listed) * 100) : 0;
  return { ratePaise: listed, billedPaise: billed, discPct, isDiscounted };
}
