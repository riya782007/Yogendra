/**
 * Canonical COD vs prepaid classification for website orders.
 *
 * Every storefront order (Razorpay AND cash-on-delivery) is placed with `cod_hold=true`
 * until the owner accepts it. That flag is NOT "this is a COD order" — it means sellable
 * stock is RESERVED (kind=reserve, no revenue) until accept/dispatch. Using it as the
 * COD-queue filter put prepaid bills on the COD tab (and labelled them Cash on Delivery)
 * while Storefront Orders correctly showed PREPAID because amount_paid covered the total.
 *
 * A real COD order is payment_mode=cod AND not already paid in full.
 * A prepaid order is everything else (online/upi/razorpay, or a leftover mode=cod that
 * was actually paid).
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

/** Unpaid COD that is still held — belongs on the COD queue AND the owner dashboard. */
export function isPendingCodQueue(o: {
  cod_hold?: boolean | null;
  payment_mode?: string | null;
  amount_paid?: number | null;
  total?: number | null;
  status?: string | null;
}): boolean {
  if (["cancelled", "refunded"].includes(String(o.status ?? "").toLowerCase())) return false;
  if (o.cod_hold !== true) return false;
  return isCodOrder(o);
}
