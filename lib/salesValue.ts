/**
 * GOODS VALUE of a bill — what the customer bought, without the overheads.
 *
 * Owner (Oct 2026): "Sales person ke record me puri sales record ho rhi h. GST packing shipping
 * adjustment nh hona chahiye. Discount sales me se less hona chahiye."
 * A salesperson's sales (and a customer's spend-target) count only the jewellery, after discount:
 *   · packing + courier/shipping (incl. COD fee) are taken out,
 *   · a positive "adjust ±" (an extra charge) is taken out; a negative one is a discount, so it is
 *     deducted — as are per-line / global discounts, which are already inside the line amounts, and a
 *     website voucher, which is already off `total`,
 *   · GST is never counted. Which bills carry GST inside `total` follows the printed invoice exactly
 *     (lib/orderBill): a GST bill not pinned EXCLUSIVE has the 3% inside the price, and a dealer
 *     trade-portal bill's total also contains it — both are taken back to pre-tax. The old rule only
 *     did this for bills explicitly marked "inclusive", so every bill made from an estimate (no GST
 *     mode set) and every dealer bill was credited to the salesperson with the GST still in it.
 * Bills, ledgers and outstanding amounts are NOT affected — they still use the full bill amount.
 */
import { isTradeExclusive, taxFromBill } from "./orderBill";

export type BillLike = {
  total?: number | null; bill_type?: string | null; gst_mode?: string | null; channel?: string | null;
  extra_packing?: number | null; extra_courier?: number | null; extra_adjustment?: number | null;
};

export const GST_RATE = 0.03;

/** True when the 3% GST sits INSIDE `orders.total` (so it has to be taken out to get goods). */
export function gstInsideTotal(o: BillLike): boolean {
  if (String(o.bill_type ?? "").toLowerCase() === "cash") return false;
  if (isTradeExclusive(o)) return true;
  return taxFromBill(o.bill_type, o.gst_mode) === "inclusive";
}

export function goodsValue(o: BillLike): number {
  const total = o.total ?? 0;
  const overheads = Math.max(0, o.extra_packing ?? 0) + Math.max(0, o.extra_courier ?? 0) + Math.max(0, o.extra_adjustment ?? 0);
  let goods = Math.max(0, total - overheads);
  if (gstInsideTotal(o)) goods = Math.round(goods / (1 + GST_RATE));
  return goods;
}

/** Overheads that are on the bill but not counted as sales (for display). */
export function billOverheads(o: BillLike): number {
  return Math.max(0, (o.total ?? 0) - goodsValue(o));
}
