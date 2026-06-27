/**
 * lib/whatsapp.ts — WhatsApp notifications (server-only).
 *
 * Default provider: Meta WhatsApp Cloud API (the official API that Interakt/WATI/AiSensy
 * all resell). Going direct = no per-message reseller markup and no vendor lock-in.
 * A Twilio adapter is included as an alternative — set WHATSAPP_PROVIDER=twilio to use it.
 *
 * Everything here is BEST-EFFORT and NON-BLOCKING: if keys are missing or a send fails,
 * we log and move on so an order is never lost because WhatsApp hiccuped.
 *
 * Keys (add in your environment — see INTEGRATIONS-SETUP.md):
 *   WHATSAPP_PROVIDER             — "meta" (default) | "twilio"
 *   OWNER_WHATSAPP_NUMBER         — where owner alerts go, E.164 e.g. 919873151767
 *
 *   --- Meta Cloud API ---
 *   WHATSAPP_PHONE_NUMBER_ID      — from Meta WhatsApp > API setup
 *   WHATSAPP_ACCESS_TOKEN         — permanent system-user token
 *   WHATSAPP_ORDER_TEMPLATE       — approved template name for order confirmations (optional;
 *                                   if unset, we send a plain text message, which only delivers
 *                                   inside the 24h customer-service window)
 *   WHATSAPP_TEMPLATE_LANG        — template language code (default en)
 *
 *   --- Twilio (alternative) ---
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM          — e.g. whatsapp:+14155238886 (sandbox) or your number
 */

const PROVIDER = () => (process.env.WHATSAPP_PROVIDER ?? "meta").toLowerCase();

export function whatsappConfigured(): boolean {
  if (PROVIDER() === "twilio") {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM);
  }
  return !!(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

/** Normalise a phone to E.164 digits (assume India +91 if a bare 10-digit number). */
export function toE164(phone?: string | null): string | null {
  if (!phone) return null;
  let d = String(phone).replace(/[^\d]/g, "");
  if (d.length === 10) d = "91" + d;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** Send a plain text WhatsApp message. Best-effort; returns true if the API accepted it. */
export async function sendWhatsAppText(to: string | null | undefined, body: string): Promise<boolean> {
  const num = toE164(to);
  if (!num || !whatsappConfigured()) return false;
  try {
    if (PROVIDER() === "twilio") return await sendTwilio(num, body);
    return await sendMetaText(num, body);
  } catch (e) {
    console.error("[whatsapp] send failed:", e);
    return false;
  }
}

async function sendMetaText(to: string, body: string): Promise<boolean> {
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_ACCESS_TOKEN!;
  const res = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body } }),
  });
  if (!res.ok) { console.error("[whatsapp/meta]", res.status, (await res.text()).slice(0, 300)); return false; }
  return true;
}

/**
 * Send the approved order-confirmation TEMPLATE (Meta). Templates deliver outside the 24h
 * window, which is what you need for transactional order alerts. Body params are positional
 * ({{1}}, {{2}}, ...). Falls back to a plain text send if no template name is configured.
 */
export async function sendMetaTemplate(to: string, params: string[]): Promise<boolean> {
  const name = process.env.WHATSAPP_ORDER_TEMPLATE;
  if (!name) return sendMetaText(to, params.join(" · "));
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID!;
  const token = process.env.WHATSAPP_ACCESS_TOKEN!;
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || "en";
  const res = await fetch(`https://graph.facebook.com/v21.0/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name,
        language: { code: lang },
        components: [{ type: "body", parameters: params.map((t) => ({ type: "text", text: t })) }],
      },
    }),
  });
  if (!res.ok) { console.error("[whatsapp/meta-template]", res.status, (await res.text()).slice(0, 300)); return false; }
  return true;
}

async function sendTwilio(to: string, body: string): Promise<boolean> {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const form = new URLSearchParams({ To: `whatsapp:+${to}`, From: from, Body: body });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${auth}` },
    body: form.toString(),
  });
  if (!res.ok) { console.error("[whatsapp/twilio]", res.status, (await res.text()).slice(0, 300)); return false; }
  return true;
}

// ---------------------------------------------------------------------------
// High-level helpers used by the order flow.
// ---------------------------------------------------------------------------

const STORE = () => process.env.NEXT_PUBLIC_STORE_NAME || "Blythe Diva";

function rupees(paise: number): string {
  return "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

/**
 * Notify the customer their order is confirmed and ping the owner. Best-effort.
 * Call WITHOUT awaiting the result if you don't want to block the response.
 */
export async function notifyOrderPlaced(args: {
  orderId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  totalPaise: number;
  payment: string; // "cod" | "online" | ...
  itemCount: number;
}): Promise<void> {
  if (!whatsappConfigured()) return;
  const shortId = String(args.orderId).slice(0, 8).toUpperCase();
  const paid = args.payment === "online" ? "Paid online" : "Cash on Delivery";

  // Customer confirmation (template if configured, else text inside 24h window).
  const cust = toE164(args.customerPhone);
  if (cust) {
    const params = [args.customerName || "there", shortId, rupees(args.totalPaise), paid];
    if (PROVIDER() === "twilio") {
      await sendTwilio(
        cust,
        `Hi ${params[0]}! Your ${STORE()} order #${shortId} is confirmed — ${args.itemCount} item(s), ${rupees(args.totalPaise)} (${paid}). We'll WhatsApp you the tracking soon. 💛`,
      ).catch(() => {});
    } else {
      await sendMetaTemplate(cust, params).catch(() => {});
    }
  }

  // Owner alert (plain text; owner has an open session with the business number).
  const owner = toE164(process.env.OWNER_WHATSAPP_NUMBER);
  if (owner) {
    await sendWhatsAppText(
      owner,
      `🛒 New ${STORE()} order #${shortId}\n${args.customerName || "Customer"} (${args.customerPhone || "no phone"})\n${args.itemCount} item(s) · ${rupees(args.totalPaise)} · ${paid}`,
    ).catch(() => {});
  }
}
