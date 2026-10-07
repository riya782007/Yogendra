/**
 * GOODS VALUE of a bill — what the customer bought, without the overheads.
 *
 * Owner (Oct 2026): "Sales ke overheads like shipping aur GST bhi employee sales aur customer targets me
 * include ho rahe hain." A salesperson's sales and a customer's spend-target now count only the jewellery:
 *   · packing + courier/shipping (incl. COD fee) are taken out,
 *   · a positive "other charges" adjustment is taken out too (a negative one is a discount, so it stays),
 *   · GST is never counted: exclusive GST is added on top of `total`, so it was never in it; for a
 *     GST-inclusive bill the 3% inside the price is removed.
 * Bills, ledgers and outstanding amounts are NOT affected — they still use the full bill amount.
 */
export type BillLike = {
  total?: number | null; bill_type?: string | null; gst_mode?: string | null;
  extra_packing?: number | null; extra_courier?: number | null; extra_adjustment?: number | null;
};

export const GST_RATE = 0.03;

export function goodsValue(o: BillLike): number {
  const total = o.total ?? 0;
  const overheads = Math.max(0, o.extra_packing ?? 0) + Math.max(0, o.extra_courier ?? 0) + Math.max(0, o.extra_adjustment ?? 0);
  let goods = Math.max(0, total - overheads);
  if (o.bill_type === "gst" && o.gst_mode === "inclusive") goods = Math.round(goods / (1 + GST_RATE));
  return goods;
}

/** Overheads that are on the bill but not counted as sales (for display). */
export function billOverheads(o: BillLike): number {
  return Math.max(0, (o.total ?? 0) - goodsValue(o));
}
