/**
 * lib/payments/razorpay.ts — Razorpay integration (server-only).
 *
 * Uses the REST API directly (no SDK to install). Two jobs:
 *   1. create an order (server authoritative amount) before opening checkout
 *   2. verify the payment signature after the customer pays
 *
 * Keys (add in your environment — see INTEGRATIONS-SETUP.md):
 *   RAZORPAY_KEY_ID          — server, secret pair id
 *   RAZORPAY_KEY_SECRET      — server, used to sign/verify (NEVER sent to the browser)
 *   NEXT_PUBLIC_RAZORPAY_KEY_ID — browser, the same key id (public, safe to expose)
 *
 * If keys are absent, isRazorpayConfigured() returns false and the storefront falls back
 * to Cash-on-Delivery only — the site keeps working with zero config.
 */
import crypto from "crypto";

const KEY_ID = () => process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = () => process.env.RAZORPAY_KEY_SECRET ?? "";

export function isRazorpayConfigured(): boolean {
  return !!(KEY_ID() && KEY_SECRET());
}

/** The public key id the browser checkout needs. */
export function razorpayPublicKeyId(): string {
  return process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || KEY_ID();
}

export type RzpOrder = { id: string; amount: number; currency: string };

/** Create a Razorpay order for an amount in paise. Returns null on failure. */
export async function createRazorpayOrder(amountPaise: number, receipt: string): Promise<RzpOrder | null> {
  if (!isRazorpayConfigured()) return null;
  const auth = Buffer.from(`${KEY_ID()}:${KEY_SECRET()}`).toString("base64");
  try {
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: Math.round(amountPaise),
        currency: "INR",
        receipt: receipt.slice(0, 40),
        payment_capture: 1,
      }),
    });
    if (!res.ok) {
      console.error("[razorpay] create order failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const j: any = await res.json();
    return { id: j.id, amount: j.amount, currency: j.currency };
  } catch (e) {
    console.error("[razorpay] create order error:", e);
    return null;
  }
}

/**
 * Verify the checkout callback signature. Razorpay signs `${order_id}|${payment_id}`
 * with HMAC-SHA256 using the key secret. Returns true only on an exact match.
 */
export function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  if (!isRazorpayConfigured() || !orderId || !paymentId || !signature) return false;
  const expected = crypto
    .createHmac("sha256", KEY_SECRET())
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
