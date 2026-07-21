/**
 * lib/ai/supportAgent.ts — the BlytheDIVA WhatsApp customer-care agent ("Diva").
 * Turns a customer's WhatsApp message + their real storefront context into a warm, professional
 * reply (with direct links) and decides when a human (the owner) must step in. Grounded ONLY in the
 * data we pass it — it never invents prices, order details, or promises. Server-only.
 */
import "server-only";
import { openaiChat, openaiConfigured, geminiChat, geminiTextConfigured } from "./providers";

export type AgentReply = { reply: string; escalate: boolean; reason?: string };

export type AgentContext = {
  message: string;
  customerName?: string | null;
  orders?: { id: string; invoice_no: string | null; total: number; status: string | null; created_at: string }[];
  categories?: { name: string; slug: string }[];
  history?: { role: "user" | "assistant"; text: string }[];
  siteBase: string;
};

const SYSTEM =
  `You are "Diva", the friendly, professional customer-care manager for BlytheDIVA — a premium Indian ` +
  `artificial/imitation jewellery D2C brand (Kundan, Polki, Meenakari, Temple, Pearl, AD). You reply to ` +
  `customers on WhatsApp. Be warm, courteous and CONCISE (WhatsApp-length, a few short lines). Mirror the ` +
  `customer's language — reply in Hindi, Hinglish or English exactly as they wrote. Use light, tasteful emojis ` +
  `sparingly. Always sound like a real boutique manager, never a robot.\n\n` +
  `WHAT YOU CAN DO: answer order status & sharing the tracking link; help discover products and share shop ` +
  `links; explain pricing, offers, COD, and shipping (free shipping over ₹999, Cash on Delivery available); ` +
  `explain the returns/exchange process at a high level; and general pre-sale questions.\n\n` +
  `HARD RULES:\n` +
  `• Use ONLY the CONTEXT provided below. NEVER invent or guess an order, price, discount, stock status, ` +
  `delivery date, or policy. If a detail isn't in the context, say you'll check and (if needed) escalate.\n` +
  `• NEVER make firm promises about refunds, replacements, delivery dates, or money — those need a human.\n` +
  `• Share the exact links from the context when relevant (order tracking link, shop/category links).\n\n` +
  `WHEN TO ESCALATE (set escalate=true): a refund/return/exchange request, a complaint, a damaged/wrong/missing ` +
  `item, "order not received"/late delivery, a payment or billing dispute, an order cancellation/modification, ` +
  `wholesale/bulk enquiry, anything you are unsure about, or the customer explicitly asks for a human. When you ` +
  `escalate, still write a warm reply that reassures the customer a team member will personally reach out ` +
  `shortly — do NOT promise a specific outcome, amount or date.\n\n` +
  `OUTPUT: return STRICT minified JSON only: {"reply": string, "escalate": boolean, "reason": string}. ` +
  `"reason" is a short internal note for the owner (why you escalated, or "" if not).`;

export async function runSupportAgent(ctx: AgentContext): Promise<AgentReply> {
  // OpenAI when enabled, otherwise Gemini — the CRM keeps answering while OpenAI billing is capped.
  const chatFn = openaiConfigured() ? openaiChat : geminiTextConfigured() ? geminiChat : null;
  if (!chatFn) {
    return {
      reply: "Thank you for messaging BlytheDIVA 💛 Our team will get back to you very shortly.",
      escalate: true,
      reason: "AI not configured — routed to owner.",
    };
  }

  const orderLines = (ctx.orders ?? []).slice(0, 6).map((o) =>
    `- ${o.invoice_no || o.id.slice(0, 8).toUpperCase()} · ${new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })} · ₹${Math.round((o.total || 0) / 100)} · status: ${o.status || "placed"} · track: ${ctx.siteBase}/account?order=${o.id}`,
  ).join("\n");
  const cats = (ctx.categories ?? []).map((c) => `${c.name} — ${ctx.siteBase}/shop/c/${c.slug}`).join("\n");
  const hist = (ctx.history ?? []).slice(-6).map((h) => `${h.role === "user" ? "Customer" : "Diva"}: ${h.text}`).join("\n");

  const user = [
    `CUSTOMER NAME: ${ctx.customerName || "(unknown)"}`,
    ``,
    `THEIR ORDERS (most recent first):`,
    orderLines || "(no orders found for this number)",
    ``,
    `SHOP LINKS:`,
    `All designs — ${ctx.siteBase}/shop`,
    cats || `(categories: ${ctx.siteBase}/shop)`,
    ``,
    `POLICIES: Free shipping over ₹999. Cash on Delivery available. Premium anti-tarnish artificial jewellery.`,
    hist ? `\nRECENT CONVERSATION:\n${hist}` : ``,
    ``,
    `CUSTOMER'S NEW MESSAGE: "${ctx.message.trim()}"`,
    ``,
    `Write Diva's reply now as strict JSON {reply, escalate, reason}.`,
  ].filter((x) => x !== undefined).join("\n");

  try {
    const raw = await chatFn({ system: SYSTEM, user, json: true, timeoutMs: 20_000 });
    const j = JSON.parse(raw);
    const reply = String(j.reply ?? "").trim() || "Thank you for messaging BlytheDIVA 💛 Our team will reach out shortly.";
    return { reply, escalate: !!j.escalate, reason: j.reason ? String(j.reason) : undefined };
  } catch {
    return {
      reply: "Thanks for your message 💛 Our team will get back to you very shortly.",
      escalate: true,
      reason: "Agent error — routed to owner.",
    };
  }
}
