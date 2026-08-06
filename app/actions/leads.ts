"use server";
/**
 * Trade-visitor lead capture.
 *
 * The wholesale catalogue is open to browse — dealers were bouncing rather than hand over a phone
 * number before they could see a single rate. We ask for details only once the visitor has shown real
 * interest, and record them here so the owner can see (and follow up with) everyone who looked.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { BUSINESS } from "@/lib/business";
import { SITE } from "@/lib/siteUrl";
import { defaultLeadMessage } from "@/lib/leadMessage";
import { openaiChat, geminiChat, groqChat, openaiConfigured, geminiTextConfigured, groqConfigured } from "@/lib/ai/providers";

export async function captureTradeVisitorAction(input: {
  name: string; phone: string; city?: string;
  visitorId?: string; designsViewed?: number; activeSeconds?: number; reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = (input.name ?? "").trim().slice(0, 120);
  const phone = (input.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20);
  if (name.length < 2) return { ok: false, error: "Please enter your name." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "Please enter a valid phone number." };

  const row: any = {
    name,
    phone,
    city: (input.city ?? "").trim().slice(0, 80) || null,
    visitor_id: (input.visitorId ?? "").trim().slice(0, 64) || null,
    designs_viewed: Math.max(0, Math.round(Number(input.designsViewed) || 0)),
    active_seconds: Math.max(0, Math.round(Number(input.activeSeconds) || 0)),
    trigger_reason: (input.reason ?? "").slice(0, 40) || null,
    status: "new",
  };

  const sb = supabaseServer();
  // A returning visitor updates their own row rather than creating a duplicate lead.
  let res = row.visitor_id
    ? await (sb.from("trade_visitors") as any).upsert(row, { onConflict: "visitor_id" })
    : await (sb.from("trade_visitors") as any).insert(row);
  if (res.error) {
    delete row.visitor_id;
    res = await (sb.from("trade_visitors") as any).insert(row);
    if (res.error) return { ok: false, error: res.error.message };
  }
  revalidatePath("/admin/visitors");
  return { ok: true };
}

/**
 * Draft or refine the outreach WhatsApp message for a trade lead, on the owner's behalf. The owner can
 * edit the text by hand OR give an instruction ("thoda chhota karo", "aur warm", "diwali offer add karo")
 * and DIVA rewrites it — grounded on the real brand facts so nothing is invented. Nothing is sent here;
 * the client opens WhatsApp with the final text pre-filled. Falls back to the default template if no AI key.
 */
export async function composeLeadMessageAction(input: {
  name?: string | null; city?: string | null; designsViewed?: number | null;
  currentText?: string | null; instruction?: string | null;
}): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "not permitted" };

  const name = (input.name ?? "").trim();
  const base = (input.currentText ?? "").trim() || defaultLeadMessage(name);
  const instruction = (input.instruction ?? "").trim();

  if (!openaiConfigured() && !geminiTextConfigured() && !groqConfigured()) {
    // No AI key configured — hand back the editable template so the owner can still tweak it by hand.
    return { ok: false, text: base, error: "AI writing needs OPENAI_API_KEY set in Vercel. You can still edit the message by hand." };
  }

  const facts =
    `Brand: ${BUSINESS.brand} (by ${BUSINESS.legalName}) — artificial/imitation jewellery, Sadar Bazar Delhi. ` +
    `Wholesale catalogue: ${SITE}/trade. Factory-direct trade rates, ₹3,000 minimum order, 2000+ designs, new arrivals weekly. WhatsApp ${BUSINESS.phone}.`;
  const lead =
    `Lead: ${name || "a wholesale dealer"}${input.city ? `, ${input.city}` : ""}` +
    `${input.designsViewed ? `, viewed ~${input.designsViewed} designs on the catalogue` : ""}.`;

  const system =
    `You are DIVA, the in-house AI for ${BUSINESS.brand}. You write the owner's outreach WhatsApp message to a wholesale dealer who just viewed the catalogue. ` +
    `Warm, respectful, human — the owner's own voice. Hinglish is welcome (Roman script). Keep it SHORT (WhatsApp length), greet by name when known, keep the ${SITE}/trade link, and end with one clear, low-pressure next step. ` +
    `A few tasteful emojis are fine. Never invent facts, discounts or claims that aren't in the context. No markdown, no placeholders like [name] — use the real name. Output ONLY the final message text, nothing else.`;
  const user = instruction
    ? `${facts}\n${lead}\n\nCurrent message:\n"""${base}"""\n\nRewrite it following this instruction: ${instruction}`
    : `${facts}\n${lead}\n\nHere is the current message:\n"""${base}"""\n\nRewrite it to be warmer and more natural while keeping the same intent and the trade link.`;

  let out = "";
  try {
    if (openaiConfigured()) out = await openaiChat({ system, user, temperature: 0.6 });
    else if (geminiTextConfigured()) out = await geminiChat({ system, user });
    else out = await groqChat({ system, user });
  } catch (e) {
    return { ok: false, text: base, error: `Couldn't rewrite it: ${e instanceof Error ? e.message : "error"}. You can still edit by hand.` };
  }
  out = out.trim().replace(/^"+|"+$/g, "").trim();
  if (!out) return { ok: false, text: base, error: "Couldn't draft that — try a different instruction." };
  return { ok: true, text: out };
}

/** Owner-side: work the list — contacted / approved / ignored. */
export async function updateTradeVisitorAction(input: { id: string; status: string; adminNote?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "not permitted" };
  const status = ["new", "contacted", "approved", "ignored"].includes(input.status) ? input.status : "new";
  const { error } = await (supabaseServer().from("trade_visitors") as any).update({
    status,
    admin_note: (input.adminNote ?? "").trim() || null,
    handled_at: status === "new" ? null : new Date().toISOString(),
  }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/visitors");
  return { ok: true };
}
