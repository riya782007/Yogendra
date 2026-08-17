/** Customer-directory helpers shared by POS (client) and server queries. No DB imports. */

const WALKIN_NAMES = new Set(["cash (w)", "cash (r)", "walk-in", "walk in", "walkin"]);

/** Placeholder "walk-in" names used at the counter for anonymous cash sales. */
export function isWalkInPlaceholder(name?: string | null, phone?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return !((phone ?? "").trim()) && (n === "" || WALKIN_NAMES.has(n));
}

/** A bill that must never count as a sale (customer spend, sales register, analytics). */
export function isCancelledSale(status?: string | null): boolean {
  const s = String(status ?? "").toLowerCase().replace(/[\s_]+/g, "");
  return s === "cancelled" || s === "canceled" || s === "refunded" || s === "void";
}

/** Live sale: not cancelled, not a pending backorder, not a held COD. */
export function isLiveSale(o: { status?: string | null; is_backorder?: boolean | null; cod_hold?: boolean | null }): boolean {
  if (isCancelledSale(o.status)) return false;
  if (o.is_backorder === true) return false;
  if (o.cod_hold === true) return false;
  return true;
}

export function phoneLast10(phone?: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** Collapse internal whitespace so "The  Opal Factory" matches "The Opal Factory". */
export function directoryNameKey(name?: string | null): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function pickDirectoryKeeper<T extends { type?: string | null; phone?: string | null; created_at?: string }>(rows: T[]): T | null {
  if (!rows?.length) return null;
  return [...rows].sort((a, b) => {
    const aw = a.type === "wholesale" ? 1 : 0, bw = b.type === "wholesale" ? 1 : 0;
    if (bw !== aw) return bw - aw;
    const ap = phoneLast10(a.phone) ? 1 : 0, bp = phoneLast10(b.phone) ? 1 : 0;
    if (bp !== ap) return bp - ap;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  })[0];
}

/** One row per real person in pickers: same name + same last-10 phone (or both nameless). */
export function collapseDirectoryCustomers<T extends { id: string; name?: string | null; phone?: string | null; type?: string | null; created_at?: string }>(rows: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const c of rows) {
    const key = `${directoryNameKey(c.name)}|${phoneLast10(c.phone)}`;
    const g = groups.get(key) ?? [];
    g.push(c);
    groups.set(key, g);
  }
  const out: T[] = [];
  for (const g of groups.values()) {
    const keeper = pickDirectoryKeeper(g);
    if (keeper) out.push(keeper);
  }
  return out;
}
