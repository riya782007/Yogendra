/**
 * Totals for an edited bill — same rules the add/edit-line RPCs use:
 * packing + courier + adjustment sit on top of the goods, and a wholesale GST bill
 * already carries 3% inside orders.total (goods × 1.03). Exclusive GST on the
 * invoice is a display/payable overlay and is NOT stored in orders.total.
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
  let items = Math.max(0, Math.round(Number(opts.itemsPaise) || 0));
  const packing = Math.max(0, Math.round(Number(opts.packingPaise) || 0));
  const courier = Math.max(0, Math.round(Number(opts.courierPaise) || 0));
  const adjustment = Math.round(Number(opts.adjustmentPaise) || 0);
  const wholesaleGst =
    String(opts.channel ?? "").toLowerCase() === "wholesale" &&
    String(opts.billType ?? "").toLowerCase() === "gst";
  if (wholesaleGst) items = Math.round(items * 1.03);
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
