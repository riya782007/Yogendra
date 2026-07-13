/**
 * lib/orderStatus.ts — one place that turns an order's raw status/fulfillment into a
 * customer-friendly tracking step. Used by the confirmation page, the public /track page and
 * the admin. Keep the step list in sync with the admin's dispatch/deliver controls.
 */
export const TRACK_STEPS = ["Placed", "Confirmed", "Dispatched", "Delivered"] as const;

export type OrderLike = {
  status?: string | null;
  fulfillment?: string | null;
  tracking_no?: string | null;
  tracking_url?: string | null;
  courier_name?: string | null;
};

/** Returns the 0-based step index and whether the order was cancelled/rejected. */
export function orderTrackStep(o: OrderLike): { index: number; cancelled: boolean } {
  const st = String(o.status ?? "").toLowerCase();
  const ff = String(o.fulfillment ?? "").toLowerCase();
  if (st === "cancelled" || st === "refunded" || ff === "rejected") return { index: -1, cancelled: true };
  if (st === "delivered" || st === "completed") return { index: 3, cancelled: false };
  if (st === "dispatched" || st === "shipped" || st === "out_for_delivery") return { index: 2, cancelled: false };
  if (ff === "accepted" || st === "confirmed" || st === "accepted" || st === "packed" || st === "processing") return { index: 1, cancelled: false };
  return { index: 0, cancelled: false };
}
