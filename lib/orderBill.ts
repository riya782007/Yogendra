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

/**
 * TRADE-PORTAL (dealer) BILLS — the one place `orders.total` already CONTAINS the GST.
 *
 * Owner, Oct 2026: "Bill GST include karke ₹8,751 ka hai, aur Sales record page par 8,751 me dobara GST
 * add kar raha hai — sirf trade portal wholesale order me." The dealer checkout stores the amount the
 * dealer agreed to (goods + 3% + shipping) in `orders.total` and marks the bill "exclusive" so the
 * invoice adds the 3% to its pre-GST lines. Every screen that then did "exclusive ⇒ total + 3%" charged
 * the GST a second time (sales record, outstanding, ledger). For these bills the grand total is worked
 * out exactly like the printed invoice: pre-GST lines + charges (taken back to pre-tax) + 3%, to ₹1.
 */
export function isTradeExclusive(o: { channel?: string | null; bill_type?: string | null; gst_mode?: string | null }): boolean {
  return String(o.channel ?? "").toLowerCase() === "wholesale"
    && String(o.bill_type ?? "").toLowerCase() !== "cash"
    && (o.gst_mode == null || o.gst_mode === "exclusive");
}

export function tradeInvoiceGrandPaise(linesPaise: number, charges: { packing?: number | null; courier?: number | null; adjustment?: number | null }, gstRate = 3): number {
  const pre = (p?: number | null) => Math.round((Number(p) || 0) / (1 + gstRate / 100));
  const taxable = Math.max(0, Math.round(linesPaise) + pre(charges.packing) + pre(charges.courier) + pre(charges.adjustment));
  return Math.round((taxable + Math.round((taxable * gstRate) / 100)) / 100) * 100;
}
