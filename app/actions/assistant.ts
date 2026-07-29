"use server";
import { groqChat, openaiChat, geminiChat, groqConfigured, openaiConfigured, geminiTextConfigured } from "@/lib/ai/providers";
import { getStorefront } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { formatPaise } from "@/lib/pricing";

export async function askAssistantAction(message: string): Promise<{ ok: boolean; reply: string }> {
  const msg = (message ?? "").trim().slice(0, 500);
  if (!msg) return { ok: true, reply: "Ask me anything about our jewellery — styles, prices, what's in stock, or gifting ideas ✨" };

  const { products, formula } = await getStorefront();
  const lines = products.slice(0, 40).map((p) => {
    const o = liveOffer(p.base_wholesale, formula);
    return `${p.category.name} — ${p.name} — ${formatPaise(o.price)} (was ${formatPaise(o.mrp)})${p.qty > 0 ? "" : " [out of stock]"}`;
  });
  const system =
    `You are "Diva", the warm, concise shopping assistant for Blythe Diva, a premium artificial-jewellery boutique in Sadar Bazar, Delhi (retail & wholesale). ` +
    `Help customers discover pieces and answer questions on price, stock, materials (brass alloy, anti-tarnish plating), care, shipping (flat ₹80 per order), Cash on Delivery, and 7-day returns.` +
    `Recommend ONLY from the catalogue below, mention the price, and keep replies short (2-4 sentences). If asked something unrelated, gently steer back to jewellery. Use at most one emoji.\n\nCATALOGUE:\n` +
    lines.join("\n");

  try {
    let reply: string;
    if (groqConfigured()) reply = await groqChat({ system, user: msg });
    else if (geminiTextConfigured()) reply = await geminiChat({ system, user: msg });
    else if (openaiConfigured()) reply = await openaiChat({ system, user: msg });
    else return { ok: true, reply: "I'd love to help you find the perfect piece! Browse our Necklaces, Earrings, Bracelets, Anklets and Rings, or tell me your budget and occasion. (The live AI assistant switches on once the store connects its AI key.)" };
    return { ok: true, reply: reply.trim() };
  } catch {
    return { ok: true, reply: "I'm having a tiny hiccup right now — please browse the collection or message us on WhatsApp and we'll help you right away!" };
  }
}
