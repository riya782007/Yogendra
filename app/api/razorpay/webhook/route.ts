import { NextResponse } from "next/server";
import { verifyRazorpayWebhookSignature, isRazorpayWebhookConfigured } from "@/lib/payments/razorpay";
import { finalizeOnlineOrderFromWebhook } from "@/app/actions/checkoutOnline";

// Razorpay needs the raw, unmodified body to verify the signature — never let a framework
// cache or transform it. force-dynamic + nodejs runtime (crypto) keep it raw.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/razorpay/webhook — server-to-server payment confirmation.
 *
 * This is the safety net for UPI: the customer is bounced to their UPI app to approve and
 * sometimes never returns to the site, so the browser handler (confirmRazorpayAction) never
 * runs. Razorpay still fires this webhook, so we place the order from the stored checkout
 * intent. The shared finaliser claims the intent atomically, so even if BOTH the browser
 * and this webhook fire, the order is placed exactly once.
 *
 * Configure in Razorpay Dashboard → Settings → Webhooks:
 *   URL    : https://<your-domain>/api/razorpay/webhook
 *   Events : payment.captured  (payment.failed optional, just logged)
 *   Secret : same value as RAZORPAY_WEBHOOK_SECRET
 *
 * Response contract (drives Razorpay's auto-retry):
 *   200 → handled (placed, or already placed, or an event we intentionally ignore)
 *   400 → bad/forged signature (no retry)
 *   500 → transient (in-flight or place_order failed) → Razorpay retries later
 */
export async function POST(req: Request) {
  if (!isRazorpayWebhookConfigured()) {
    // No secret configured — accept-and-ignore so Razorpay doesn't hammer retries.
    return NextResponse.json({ ok: true, ignored: "webhook secret not configured" });
  }

  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");
  if (!verifyRazorpayWebhookSignature(raw, signature)) {
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const type = event?.event as string | undefined;

  // We only act on a captured payment. Everything else is acknowledged and ignored.
  if (type !== "payment.captured" && type !== "order.paid") {
    return NextResponse.json({ ok: true, ignored: type ?? "unknown" });
  }

  const payment = event?.payload?.payment?.entity;
  const razorpayOrderId: string | undefined = payment?.order_id ?? event?.payload?.order?.entity?.id;
  const paymentId: string | undefined = payment?.id;
  if (!razorpayOrderId || !paymentId) {
    // Nothing we can act on, but don't make Razorpay retry forever.
    return NextResponse.json({ ok: true, ignored: "missing order/payment id" });
  }

  const res = await finalizeOnlineOrderFromWebhook(razorpayOrderId, paymentId);
  if (res.ok) return NextResponse.json({ ok: true, orderId: res.orderId });
  // Transient (in-flight claim, or place_order error) → 500 so Razorpay retries; a hard
  // "no context" failure also returns 500 since the money is captured and needs attention.
  return NextResponse.json({ ok: false, error: res.error ?? "not finalised" }, { status: 500 });
}
