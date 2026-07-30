import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { sendWhatsAppText, toE164 } from "@/lib/whatsapp";
import { normalizePhone } from "@/lib/customerAuth";
import { getCustomerProfile, getCustomerOrders, getCategories } from "@/lib/supabase/queries";
import { runSupportAgent } from "@/lib/ai/supportAgent";

// The webhook must see the RAW body (for Meta's signature) and can run the AI agent (a few seconds),
// so keep it dynamic on the Node runtime with a generous timeout.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Meta WhatsApp Cloud API webhook for the AI customer-care agent ("Diva").
 *
 * Configure in Meta → your app → WhatsApp → Configuration → Webhook:
 *   Callback URL : https://<your-domain>/api/whatsapp/webhook
 *   Verify token : the value of WHATSAPP_VERIFY_TOKEN
 *   Subscribe to : the "messages" field
 *
 * GET  → one-time verification handshake (echoes hub.challenge when the token matches).
 * POST → an inbound customer message: the agent replies with real storefront context, logs the
 *        conversation, and escalates to the owner's WhatsApp when a human is needed.
 */

// GET — Meta's subscription verification handshake.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected) {
    return new NextResponse(challenge ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("forbidden", { status: 403 });
}

/** Optional but recommended: verify the payload actually came from Meta (App Secret HMAC). */
function signatureOk(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // not configured → rely on the (secret) verify-token handshake + obscure URL
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const got = header.slice(7);
  try { return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex")); } catch { return false; }
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("bad signature", { status: 401 });
  }
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: true }); }

  try {
    for (const entry of (body?.entry ?? [])) {
      for (const change of (entry?.changes ?? [])) {
        const value = change?.value ?? {};
        const profileName = value?.contacts?.[0]?.profile?.name ?? null;
        for (const m of (value?.messages ?? [])) {
          await handleMessage(m, profileName).catch((e) => console.error("[wa webhook] handle:", e));
        }
      }
    }
  } catch (e) {
    console.error("[wa webhook] parse:", e);
  }
  // ALWAYS 200 quickly so Meta doesn't retry-storm; idempotency guards double-processing.
  return NextResponse.json({ ok: true });
}

/**
 * Deterministic, INSTANT replies for the essentials the owner asked for — a warm welcome + the shop
 * links + wholesale link. These need NO AI/LLM key, so they work the moment the number is connected and
 * always answer in under a second. Returns null to hand anything more specific to the "Diva" AI agent.
 */
function quickReply(text: string, firstContact: boolean, site: string): string | null {
  const t = text.toLowerCase().trim();
  const trade = `${site}/trade`;
  const greeting = t.length <= 3 || /\b(hi+|hey+|hell?o+|namaste|namaskar|hola|salaam|ram ram|good (morning|afternoon|evening))\b/.test(t);
  const wholesale = /(wholesale|bulk|dealer|reseller|thok|distributor)/.test(t);
  const catalog = /(catalog|catalogue|collection|design|product|item|dikha|dekh|latest|new arrival|showroom|link)/.test(t);
  const price = /(price|rate|cost|kitne|kitna|daam|k[ei]mat|₹)/.test(t);
  if (wholesale) {
    return `🏬 For wholesale / bulk (dealer rates), please browse and order here:\n${trade}\n\nShare the designs + quantity you need and we'll confirm right away. 💛`;
  }
  if (firstContact || greeting) {
    return `Hi! 🙏 Welcome to *Blythe Diva* 💎\nPremium anti-tarnish artificial jewellery, direct from our Sadar Bazar (Delhi) factory.\n\n🛍️ Browse & order: ${site}\n🏬 Wholesale / dealers: ${trade}\n\nTell us what you're looking for — necklace, earrings, bracelet, anklet, ring or watch — and we'll help right away! ✨`;
  }
  if (catalog || price) {
    return `Here's our full collection with live prices 👇\n🛍️ ${site}\n\nSend me the design (or a photo) you like and I'll share the details. 💎`;
  }
  return null;
}

async function handleMessage(m: any, profileName: string | null) {
  const from = String(m?.from || "").replace(/[^\d]/g, "");
  if (!from) return;
  const sb = supabaseServer();
  const waId = m?.id ? String(m.id) : null;
  const text = m?.type === "text" ? String(m?.text?.body ?? "").trim() : "";

  // Idempotent inbound insert — a duplicate wa_message_id (Meta retry) fails the unique index, so we
  // stop and never reply twice.
  if (waId) {
    const { error } = await sb.from("whatsapp_messages").insert({ phone: from, direction: "in", body: text || `[${m?.type}]`, wa_message_id: waId });
    if (error) return;
  } else {
    await sb.from("whatsapp_messages").insert({ phone: from, direction: "in", body: text || `[${m?.type}]` });
  }

  // Non-text (image / audio / etc.) — nudge them to type, and continue.
  if (!text) {
    const nudge = "Thank you for your message 💛 Could you please type your question so I can help you right away?";
    await sendWhatsAppText(from, nudge);
    await sb.from("whatsapp_messages").insert({ phone: from, direction: "out", body: nudge });
    return;
  }

  const phone10 = normalizePhone(from);
  const [profile, orders, cats, hist] = await Promise.all([
    getCustomerProfile(phone10).catch(() => null),
    getCustomerOrders(phone10).catch(() => []),
    getCategories().catch(() => []),
    sb.from("whatsapp_messages").select("direction,body").eq("phone", from).order("created_at", { ascending: false }).limit(8),
  ]);
  const history = (((hist as any)?.data as any[]) ?? [])
    .filter((r) => r.direction === "in" || r.direction === "out")
    .reverse()
    .map((r) => ({ role: (r.direction === "in" ? "user" : "assistant") as "user" | "assistant", text: r.body || "" }));
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || "https://blythediva.com").replace(/\/$/, "");

  // INSTANT ESSENTIALS FIRST: a welcome + shop links (and wholesale link) fire immediately — no AI key
  // needed and no latency — for greetings, first contact, and catalogue/price/wholesale asks. This is the
  // minimal "always share the site + welcome" behaviour the owner wanted; the AI only handles the rest.
  const priorInbound = history.filter((h) => h.role === "user").length; // includes the current message
  const quick = quickReply(text, priorInbound <= 1, siteBase);
  if (quick) {
    await sendWhatsAppText(from, quick);
    await sb.from("whatsapp_messages").insert({ phone: from, direction: "out", body: quick });
    return;
  }

  const res = await runSupportAgent({
    message: text,
    customerName: profile?.name || profileName,
    orders: orders as any,
    categories: ((cats as any[]) ?? []).map((c) => ({ name: c.name, slug: c.slug })),
    history,
    siteBase,
  });

  await sendWhatsAppText(from, res.reply);
  await sb.from("whatsapp_messages").insert({ phone: from, direction: "out", body: res.reply, escalated: res.escalate });

  if (res.escalate) {
    const owner = process.env.OWNER_WHATSAPP_NUMBER;
    if (owner) {
      const alert = `🔔 BlytheDIVA — a customer needs help\nFrom: +${toE164(from) ?? from}${profile?.name ? ` (${profile.name})` : profileName ? ` (${profileName})` : ""}\nThey said: "${text.slice(0, 300)}"\nReason: ${res.reason || "needs a human"}\nOpen WhatsApp to reply to them directly.`;
      await sendWhatsAppText(owner, alert);
      await sb.from("whatsapp_messages").insert({ phone: from, direction: "owner", body: alert, escalated: true });
    }
  }
}
