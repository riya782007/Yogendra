"use server";
/**
 * Customer account auth via WhatsApp OTP.
 *   send  → generate a 6-digit code, store it hashed (5-min expiry), deliver over WhatsApp.
 *   verify→ check the code, upsert the customer, set a signed session cookie.
 *   logout→ clear the cookie.
 * Security: the raw code is NEVER returned to the browser when WhatsApp is configured — it only
 * goes over WhatsApp. In a dev setup with NO WhatsApp keys, the code is returned so the flow is
 * still testable. Codes are rate-limited and attempt-capped.
 */
import { revalidatePath } from "next/cache";
import crypto from "crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { setCustomerSession, clearCustomerSession, normalizePhone } from "@/lib/customerAuth";
import { sendWhatsAppText, whatsappConfigured, toE164 } from "@/lib/whatsapp";
import { ensureDirectoryCustomer } from "@/lib/supabase/queries";

const hashCode = (code: string) => crypto.createHash("sha256").update(`${code}|blythediva-otp`).digest("hex");

export async function sendCustomerOtpAction(phoneRaw: string): Promise<{ ok: boolean; error?: string; devCode?: string }> {
  const phone = normalizePhone(phoneRaw);
  if (phone.length !== 10) return { ok: false, error: "Enter a valid 10-digit mobile number." };
  const sb = supabaseServer();

  // Light rate-limit: one code per 30s per number.
  const { data: existing } = await sb.from("customer_otps").select("last_sent_at").eq("phone", phone).maybeSingle();
  if (existing?.last_sent_at && Date.now() - new Date(existing.last_sent_at as string).getTime() < 30_000) {
    return { ok: false, error: "Please wait a few seconds before requesting another code." };
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await sb.from("customer_otps").upsert({
    phone, code_hash: hashCode(code), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    attempts: 0, last_sent_at: new Date().toISOString(),
  });

  // No WhatsApp configured → return the code so the owner can test the flow (dev only).
  if (!whatsappConfigured()) return { ok: true, devCode: code };

  const e164 = toE164(phone);
  const body = `${code} is your Blythe Diva login code. It expires in 5 minutes. Do not share it with anyone.`;
  // Deliver over WhatsApp; the code is never returned to the browser. (For guaranteed delivery to a
  // first-time number outside the 24h window, an approved WhatsApp Authentication template is needed.)
  const delivered = e164 ? await sendWhatsAppText(e164, body).catch(() => false) : false;
  if (!delivered) return { ok: false, error: "Couldn't send the code on WhatsApp. Please try again in a moment." };
  return { ok: true };
}

export async function verifyCustomerOtpAction(input: { phone: string; code: string; name?: string }): Promise<{ ok: boolean; error?: string }> {
  const phone = normalizePhone(input.phone);
  const code = (input.code ?? "").replace(/\D/g, "").trim();
  if (phone.length !== 10) return { ok: false, error: "Enter a valid mobile number." };
  if (code.length < 4) return { ok: false, error: "Enter the code you received." };
  const sb = supabaseServer();

  const { data: row } = await sb.from("customer_otps").select("*").eq("phone", phone).maybeSingle();
  if (!row) return { ok: false, error: "Request a code first." };
  if (new Date((row as any).expires_at).getTime() < Date.now()) return { ok: false, error: "Code expired — request a new one." };
  if (((row as any).attempts ?? 0) >= 5) return { ok: false, error: "Too many attempts — request a new code." };
  if ((row as any).code_hash !== hashCode(code)) {
    await sb.from("customer_otps").update({ attempts: ((row as any).attempts ?? 0) + 1 }).eq("phone", phone);
    return { ok: false, error: "Incorrect code — try again." };
  }

  // Success: consume the code, upsert the customer, set the session.
  await sb.from("customer_otps").delete().eq("phone", phone);
  const nm = (input.name ?? "").trim();
  await ensureDirectoryCustomer(sb, { name: nm || phone, phone, type: "retail" });
  setCustomerSession(phone);
  revalidatePath("/account");
  return { ok: true };
}

export async function logoutCustomerAction(): Promise<void> {
  clearCustomerSession();
  revalidatePath("/account");
}
