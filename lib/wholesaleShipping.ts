/**
 * Owner's fixed wholesale shipping slabs (paise in → paise out).
 *   ₹3,000–7,000 → ₹300 · ₹7,001–12,000 → ₹400 · ₹12,001–20,000 → ₹600 · ₹20,001–30,000 → ₹900
 *   above ₹30,000 → 0 here (the store contacts the dealer to quote shipping separately).
 * Lives OUTSIDE the "use server" action file because server-action modules may only export
 * async functions — this pure helper is shared by the action and any UI mirror.
 */
export function wholesaleShippingPaise(totalPaise: number): number {
  if (totalPaise > 3000000) return 0;
  if (totalPaise > 2000000) return 90000;
  if (totalPaise > 1200000) return 60000;
  if (totalPaise > 700000) return 40000;
  return 30000;
}
/** Flat ₹120 per COD order. */
export const WHOLESALE_COD_FEE_PAISE = 12000;
