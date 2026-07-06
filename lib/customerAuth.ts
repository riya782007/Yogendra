import "server-only";
/**
 * Customer (retail) account session — a stateless, HMAC-signed httpOnly cookie so a shopper stays
 * logged in after verifying a WhatsApp OTP. The cookie is `phone.expiry.hmac`; it can't be forged
 * without the server secret. Read it anywhere with getCustomerSession(); set/clear it only from a
 * Server Action (Next only allows cookie writes there).
 */
import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE = "bd_customer";
const TTL_DAYS = 60;

function secret(): string {
  return process.env.CUSTOMER_SESSION_SECRET || process.env.ADMIN_SESSION_TOKEN || "bd-customer-session-secret-v1";
}
function sign(phone: string, exp: number): string {
  return crypto.createHmac("sha256", secret()).update(`${phone}.${exp}`).digest("hex");
}

/** Normalise any input to the canonical 10-digit mobile used as the account key. */
export function normalizePhone(phone?: string | null): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

export type CustomerSession = { phone: string };

/** The signed-in shopper, or null. Safe to call in any server component. */
export function getCustomerSession(): CustomerSession | null {
  const raw = cookies().get(COOKIE)?.value;
  if (!raw) return null;
  const [phone, expS, mac] = raw.split(".");
  if (!phone || !expS || !mac) return null;
  const exp = Number(expS);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  const expect = sign(phone, exp);
  try {
    if (mac.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return { phone };
}

/** Set the session cookie (call from a Server Action only). */
export function setCustomerSession(phone: string): void {
  const exp = Date.now() + TTL_DAYS * 86400000;
  const value = `${phone}.${exp}.${sign(phone, exp)}`;
  cookies().set(COOKIE, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: TTL_DAYS * 86400 });
}

/** Clear the session cookie (call from a Server Action only). */
export function clearCustomerSession(): void {
  cookies().set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
