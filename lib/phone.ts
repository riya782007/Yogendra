/**
 * Phone matching for admin search (abandoned carts, last-4 lookup).
 *
 * Shoppers type numbers in every shape: +230 5452 4641, +1 783-739-1427, 98765 43210.
 * The owner often only has the last 4 digits. Matching is always on digits-only.
 */

export function phoneDigits(raw?: string | null): string {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  return d;
}

/**
 * True when `phone` belongs to the shopper the owner is typing.
 *  • 4–6 digit query → last-N of the stored number (the "last 4" case).
 *  • 7+ digit query  → same shopper across +230 / +91 / local (suffix overlap).
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
