/**
 * Phone matching for admin search and WhatsApp links.
 *
 * Shoppers type numbers in every shape: +1 783-739-1427, 07837391427, 98765 43210, +91-9876543210.
 * The owner often only has the last 4 digits from a US (or any) order slip. Matching is always on
 * digits-only, never on the raw formatted string.
 */

/** Digits only. Strips a leading international 00. Leaves a trunk 0 in place so callers can decide. */
export function phoneDigits(raw?: string | null): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}

/**
 * True when `phone` belongs to the shopper the owner is typing.
 *  • 4–6 digit query → last-N of the stored number (the "last 4" case).
 *  • 7+ digit query  → same shopper across +1 / +91 / local (suffix / national overlap).
 */
export function phoneMatchesQuery(phone?: string | null, query?: string | null): boolean {
  const q = phoneDigits(query);
  const d = phoneDigits(phone);
  if (q.length < 4 || d.length < 4) return false;
  if (d.endsWith(q) || q.endsWith(d)) return true;
  if (q.length >= 7) {
    const a = d.slice(-10);
    const b = q.slice(-10);
    if (a.length >= 7 && b.length >= 7 && (a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a))) return true;
    if (d.includes(q) || q.includes(d)) return true;
  }
  return false;
}

/** Two captured numbers are the same person (never last-4 — too many collisions to bill the wrong cart). */
export function phonesAreSameShopper(a?: string | null, b?: string | null): boolean {
  const da = phoneDigits(a);
  const db = phoneDigits(b);
  if (da.length < 7 || db.length < 7) return da.length >= 7 && da === db;
  if (da === db || da.endsWith(db) || db.endsWith(da)) return true;
  const n = Math.min(10, da.length, db.length);
  return n >= 7 && da.slice(-n) === db.slice(-n);
}

export function nameMatchesQuery(name?: string | null, query?: string | null): boolean {
  const q = String(query ?? "").trim().toLowerCase();
  if (q.length < 2) return false;
  const letters = q.replace(/[0-9+\-()\s]/g, "").trim();
  const n = String(name ?? "").toLowerCase();
  if (!n) return false;
  if (n.includes(q)) return true;
  return letters.length >= 2 && n.includes(letters);
}

export function recordMatchesShopperQuery(
  rec: { phone?: string | null; customer_name?: string | null; name?: string | null },
  query: string,
): boolean {
  const q = query.trim();
  if (!q) return true;
  if (phoneMatchesQuery(rec.phone, q)) return true;
  return nameMatchesQuery(rec.customer_name ?? rec.name, q);
}

/**
 * WhatsApp / tel digits. Bare 10-digit numbers are treated as India (+91). Numbers that already
 * include a country code (US +1 = 11 digits starting with 1, +91 = 12 digits, etc.) are left alone
 * so a US visitor is not opened as an Indian chat.
 */
export function whatsAppDigits(phone?: string | null): string | null {
  let d = phoneDigits(phone);
  if (!d) return null;
  if (d.startsWith("0") && d.length === 11) d = d.slice(1);
  if (d.length === 10) d = "91" + d;
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export function waMeHref(phone?: string | null, message?: string): string | null {
  const d = whatsAppDigits(phone);
  if (!d) return null;
  const q = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${d}${q}`;
}
