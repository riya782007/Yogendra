/**
 * Canonical COD vs prepaid classification for website orders.
 *
 * Every storefront order (Razorpay AND cash-on-delivery) is placed with `cod_hold=true`
 * until the owner accepts it. That flag is NOT "this is a COD order" — it only means
 * "stock/revenue are held". Using it as the COD-queue filter put prepaid bills on the
 * COD tab (and labelled them Cash on Delivery) while Storefront Orders correctly showed
 * PREPAID because amount_paid covered the total.
 *
 * A real COD order is payment_mode=cod AND not already paid in full.
 * A prepaid order is everything else (online/upi/razorpay, or a leftover mode=cod that
 * was actually paid).
 *
 * ALWAYS use isCodOrder / isPrepaidOrder / paymentLabel for UI labels and queue filters —
 * never infer from cod_hold alone. This prevents COD↔prepaid mix-ups.
 */

export function isCodPaymentMode(mode?: string | null): boolean {
  return String(mode ?? "").trim().toLowerCase() === "cod";
}

export function isFullyPaid(amountPaid?: number | null, total?: number | null): boolean {
  const t = Number(total ?? 0);
  const p = Number(amountPaid ?? 0);
  return t > 0 && p >= t;
}

export function isCodOrder(o: {
  payment_mode?: string | null;
  amount_paid?: number | null;
  total?: number | null;
}): boolean {
  if (isFullyPaid(o.amount_paid, o.total)) return false;
  return isCodPaymentMode(o.payment_mode);
}

export function isPrepaidOrder(o: {
  payment_mode?: string | null;
  amount_paid?: number | null;
  total?: number | null;
}): boolean {
  return !isCodOrder(o);
}

/** Short owner-facing label — use everywhere (dashboard, orders list, notifications, PDF). */
export function paymentLabel(o: {
  payment_mode?: string | null;
  amount_paid?: number | null;
  total?: number | null;
}): "COD" | "PREPAID" {
  return isCodOrder(o) ? "COD" : "PREPAID";
}

/** Longer label for badges / packing slips. */
export function paymentLabelLong(o: {
  payment_mode?: string | null;
  amount_paid?: number | null;
  total?: number | null;
}): string {
  if (isCodOrder(o)) return "Cash on Delivery";
  if (isFullyPaid(o.amount_paid, o.total)) return "PREPAID ✓";
  const paid = Number(o.amount_paid ?? 0);
  if (paid > 0) return "Part-paid (prepaid)";
  return "PREPAID (unpaid / pending verify)";
}
