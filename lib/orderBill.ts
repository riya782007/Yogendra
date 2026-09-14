/**
 * Totals for an edited bill: packing + courier + adjustment sit on top of the goods.
 *
 * Sept 2026 — this used to multiply the goods by 1.03 on a wholesale GST bill, putting a SECOND 3%
 * into orders.total and leaving every such bill out of step with its own printed invoice.
 *
 * Worked example from a real bill: goods ₹3,140 + courier ₹300.
 *   printed invoice grand total = 3,140 + 300        = ₹3,440.00
 *   stored orders.total (old)   = 3,140 × 1.03 + 300 = ₹3,534.20
 * The dealer was billed ₹3,440 while the system recorded ₹3,534.20 owed — a phantom ₹94.20 that
 * never clears however much he pays, because it was never on his invoice.
 *
 * The 1.03 was simply wrong: prices in this system ALREADY include GST. Dealer rates are served
 * through gstInc() in lib/catalogSlice.ts, and the invoice therefore EXTRACTS the CGST/SGST share
 * from inside the price rather than adding it — its own comments say so. Three places, one rule:
 * GST is inside the price. Adding 3% here broke that rule and only for wholesale GST bills, which
 * is why it went unnoticed.
 *
 * Exclusive GST stays a per-bill display/payable overlay on the invoice and is still never stored.
 * `channel` and `billType` remain on the signature so no caller has to change.
 */
export type BillTax = "none" | "inclusive" | "exclusive";

export function orderStoredTotalPaise(opts: {
  itemsPaise: number;
  packingPaise?: number;
  courierPaise?: number;
  adjustmentPaise?: number;
  channel?: string | null;
  billType?: string | null;
}): number {
  const items = Math.max(0, Math.round(Number(opts.itemsPaise) || 0));
  const packing = Math.max(0, Math.round(Number(opts.packingPaise) || 0));
  const courier = Math.max(0, Math.round(Number(opts.courierPaise) || 0));
  const adjustment = Math.round(Number(opts.adjustmentPaise) || 0);
  // Goods are stored exactly as billed — identical arithmetic to the invoice's grand total.
  return Math.max(0, items + packing + courier + adjustment);
}

/** What the customer is asked to pay (matches the printed invoice). */
export function orderPayablePaise(storedTotalPaise: number, tax: BillTax, gstRate = 3): number {
  const t = Math.max(0, Math.round(Number(storedTotalPaise) || 0));
  if (tax === "exclusive") return t + Math.round((t * gstRate) / 100);
  return t;
}

export function billTypeFromTax(tax: BillTax): "gst" | "cash" {
  return tax === "none" ? "cash" : "gst";
}

export function gstModeFromTax(tax: BillTax): "inclusive" | "exclusive" | null {
  if (tax === "none") return null;
  return tax;
}

export function taxFromBill(billType?: string | null, gstMode?: string | null): BillTax {
  if (String(billType ?? "").toLowerCase() === "cash") return "none";
  return gstMode === "exclusive" ? "exclusive" : "inclusive";
}
