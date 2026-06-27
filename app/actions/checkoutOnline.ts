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
  customer?: Customer,
): Promise<{ ok: boolean; error?: string; orderId?: string; amount?: number; currency?: string; keyId?: string }> {
  if (!isRazorpayConfigured()) return { ok: false, error: "Online payment isn't set up yet. Please choose Cash on Delivery." };
  if (!items?.length) return { ok: false, error: "Your bag is empty." };
  const itemsTotal = await quoteItemsPaise(items);
  if (itemsTotal <= 0) return { ok: false, error: "Couldn't price your bag — please refresh." };
  const amount = itemsTotal + shippingPaise(itemsTotal);
  const order = await createRazorpayOrder(amount, `rcpt_${Date.now()}`);
  if (!order) return { ok: false, error: "Couldn't start the payment. Please try again or use Cash on Delivery." };

  // Persist the cart + customer against the Razorpay order id so the webhook can finalise
  // the order even if the customer's browser never returns from their UPI app (Pillar 9).
  // Best-effort: a failed insert doesn't block checkout — the browser handler still works.
  if (customer?.name && customer?.phone && customer?.address) {
    try {
      const sb = supabaseServer();
      await sb.from("checkout_intents").insert({
        razorpay_order_id: order.id,
        items: items.map((i) => ({ sku: i.sku, qty: i.qty, color: i.color ?? null })),
        customer,
        amount: order.amount,
        status: "pending",
      });
    } catch {
      /* non-blocking — the browser handler path still records the order */
    }
  }
  return { ok: true, orderId: order.id, amount: order.amount, currency: order.currency, keyId: razorpayPublicKeyId() };
}

/**
 * The single, idempotent finaliser for an online order. Called by BOTH the browser handler
 * (confirmRazorpayAction) and the server-to-server webhook. It atomically "claims" the
 * checkout intent (pending → placing) so only one caller ever places the order; the other
 * sees it's already handled. On success the intent flips to 'placed' with the order id.
 */
async function finalizeOnlineOrder(args: {
  razorpayOrderId: string;
  paymentId: string;
  items?: CartItem[];
  customer?: Customer;
}): Promise<{ ok: boolean; orderId?: string; error?: string; retry?: boolean }> {
  const sb = supabaseServer();

  // Optimistic claim: only the caller that flips pending→placing proceeds to place.
  const { data: claimed } = await sb
    .from("checkout_intents")
    .update({ status: "placing" })
    .eq("razorpay_order_id", args.razorpayOrderId)
    .eq("status", "pending")
    .select("items,customer")
    .maybeSingle();

  let items = args.items;
  let customer = args.customer;

  if (!claimed) {
    // Someone else already claimed/placed it, or there's no intent row at all.
    const { data: existing } = await sb
      .from("checkout_intents")
      .select("status,order_id")
      .eq("razorpay_order_id", args.razorpayOrderId)
      .maybeSingle();
    if (existing?.order_id) return { ok: true, orderId: existing.order_id }; // already placed ✓
    if (existing?.status === "placing") return { ok: false, retry: true };   // in flight — retry later
    // No intent (e.g. legacy/insert failed): fall back to whatever the caller passed in.
    if (!items?.length || !customer) return { ok: false, error: "Order context missing.", retry: false };
  } else {
    items = (claimed.items as CartItem[]) ?? items;
    customer = (claimed.customer as Customer) ?? customer;
  }

  if (!items?.length || !customer) return { ok: false, error: "Order context missing.", retry: false };

  const { data, error } = await sb.rpc("place_order", {
    p_items: items.map((i) => ({ sku: i.sku, qty: i.qty, color: i.color })),
    p_customer: customer,
    p_channel: "retail",
    p_payment: "online",
    p_allow_oversell: false, // online checkout never oversells
    p_tier: "retail",
  });
  if (error) {
    // Release the claim so a webhook retry (or the other path) can try again.
    await sb.from("checkout_intents").update({ status: "pending" }).eq("razorpay_order_id", args.razorpayOrderId).eq("status", "placing");
    return { ok: false, error: error.message, retry: true };
  }
  const orderId = (data as any)?.order_id as string;
  const total = (data as any)?.total as number;

  // Mark fully paid + record the Razorpay payment id. Razorpay/UPI settles to bank → bank book.
  await sb.from("orders").update({
    amount_paid: total, payment_mode: "online", payment_ref: args.paymentId, pay_bank: total,
  }).eq("id", orderId);

  await sb.from("checkout_intents").update({
    status: "placed", order_id: orderId, payment_ref: args.paymentId, placed_at: new Date().toISOString(),
  }).eq("razorpay_order_id", args.razorpayOrderId);

  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: items.map((i) => ({ sku: i.sku, qty: i.qty })) }).catch(() => {});
  await notifyOrderPlaced({
    orderId, customerName: customer.name, customerPhone: customer.phone,
    totalPaise: total, payment: "online", itemCount: items.reduce((n, i) => n + i.qty, 0),
  }).catch(() => {});

  return { ok: true, orderId };
}

/** Server-to-server finaliser used by the Razorpay webhook (caller already verified the
 *  webhook signature). Exposed so app/api/razorpay/webhook can place the order from stored
 *  intent context when the browser never returned. */
export async function finalizeOnlineOrderFromWebhook(razorpayOrderId: string, paymentId: string) {
  return finalizeOnlineOrder({ razorpayOrderId, paymentId });
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
  const res = await finalizeOnlineOrder({
    razorpayOrderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    items: input.items,
    customer: input.customer,
  });
  if (!res.ok && res.retry) return { ok: false, error: "We're confirming your payment — you'll get a WhatsApp shortly. If not, contact us with your payment id." };
  return res.ok ? { ok: true, orderId: res.orderId } : { ok: false, error: res.error ?? "We couldn't confirm your order — please contact us." };
}
