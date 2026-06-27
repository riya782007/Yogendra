"use server";
/**
 * Online (Razorpay) checkout flow for the retail storefront.
 *
 *   1. createRazorpayOrderAction(items)  — server quotes the cart authoritatively, creates a
 *                                          Razorpay order for that amount, returns the handle
 *                                          the browser checkout needs.
 *   2. confirmRazorpayAction({...})       — after the customer pays, verifies the signature,
 *                                          THEN places the order in our DB (decrements stock,
 *                                          marks paid), records the payment id, and fires the
 *                                          WhatsApp confirmation.
 *
 * Verifying the signature server-side before placing the order is the whole security point:
 * the browser can't fake a paid order.
 */
import { supabaseServer } from "@/lib/supabase/server";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices } from "@/lib/pricing";
import { createRazorpayOrder, verifyRazorpaySignature, isRazorpayConfigured, razorpayPublicKeyId } from "@/lib/payments/razorpay";
import { notifyOrderPlaced } from "@/lib/whatsapp";
import { sendPurchase } from "@/lib/ga4";

type CartItem = { sku: string; qty: number; color?: string };
type Customer = { name: string; phone: string; address: string; pincode?: string; city?: string };

/** Free shipping over ₹999, else ₹50. Mirrors the checkout UI. */
function shippingPaise(itemsTotal: number): number {
  return itemsTotal >= 99900 || itemsTotal === 0 ? 0 : 5000;
}

/** Authoritative server-side cart total in paise (items only), mirroring billing's bd_price. */
async function quoteItemsPaise(items: CartItem[]): Promise<number> {
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const skus = [...new Set(items.map((i) => i.sku))];
  const { data: prods } = await sb
    .from("products")
    .select("sku, base_wholesale, retail_override, variants(color, retail_override)")
    .in("sku", skus);
  const map = new Map<string, any>(((prods as any[]) ?? []).map((p) => [p.sku, p]));
  let total = 0;
  for (const it of items) {
    const p = map.get(it.sku);
    if (!p) continue;
    const variant = it.color
      ? (p.variants ?? []).find((v: any) => String(v.color ?? "").toLowerCase() === String(it.color).toLowerCase())
      : null;
    const unit = resolvePrices(
      p.base_wholesale,
      formula,
      variant ? { retail: variant.retail_override } : null,
      { retail: p.retail_override },
    ).retailPrice;
    total += unit * Math.max(1, it.qty | 0);
  }
  return total;
}

export async function createRazorpayOrderAction(
  items: CartItem[],
): Promise<{ ok: boolean; error?: string; orderId?: string; amount?: number; currency?: string; keyId?: string }> {
  if (!isRazorpayConfigured()) return { ok: false, error: "Online payment isn't set up yet. Please choose Cash on Delivery." };
  if (!items?.length) return { ok: false, error: "Your bag is empty." };
  const itemsTotal = await quoteItemsPaise(items);
  if (itemsTotal <= 0) return { ok: false, error: "Couldn't price your bag — please refresh." };
  const amount = itemsTotal + shippingPaise(itemsTotal);
  const order = await createRazorpayOrder(amount, `rcpt_${Date.now()}`);
  if (!order) return { ok: false, error: "Couldn't start the payment. Please try again or use Cash on Delivery." };
  return { ok: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayPublicKeyId() };
}

export async function confirmRazorpayAction(input: {
  items: CartItem[];
  customer: Customer;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = input;
  if (!verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
    return { ok: false, error: "Payment could not be verified. If money was deducted it will be refunded automatically." };
  }
  if (!input.items?.length) return { ok: false, error: "Your bag is empty." };
  if (!input.customer?.name || !input.customer?.phone || !input.customer?.address) {
    return { ok: false, error: "Please fill name, phone and address." };
  }

  const sb = supabaseServer();
  const { data, error } = await sb.rpc("place_order", {
    p_items: input.items.map((i) => ({ sku: i.sku, qty: i.qty, color: i.color })),
    p_customer: input.customer,
    p_channel: "retail",
    p_payment: "online",
    p_allow_oversell: false, // online checkout never oversells
    p_tier: "retail",
  });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id as string;
  const total = (data as any)?.total as number;

  // Mark fully paid + record the Razorpay payment id.
  await sb.from("orders").update({
    amount_paid: total,
    payment_mode: "online",
    payment_ref: razorpay_payment_id,
    pay_bank: total, // Razorpay/UPI settles to bank — count it in the bank book (Pillar 9)
  }).eq("id", orderId);

  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })) });
  await notifyOrderPlaced({
    orderId, customerName: input.customer.name, customerPhone: input.customer.phone,
    totalPaise: total, payment: "online", itemCount: input.items.reduce((n, i) => n + i.qty, 0),
  }).catch(() => {});

  return { ok: true, orderId };
}
