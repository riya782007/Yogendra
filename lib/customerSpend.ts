/** Customer-directory keys shared by POS, estimates, and promotional spend. */

const WALKIN_NAMES = new Set(["cash (w)", "cash (r)", "walk-in", "walk in", "walkin"]);

export function isWalkInPlaceholder(name?: string | null, phone?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return !((phone ?? "").trim()) && (n === "" || WALKIN_NAMES.has(n));
}

export function phoneLast10(phone?: string | null): string {
  const d = (phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export function directoryNameKey(name?: string | null): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Printed bill grand total (paise) — same rules as the invoice page. */
export function billGrandPaise(o: { total?: number | null; bill_type?: string | null; gst_mode?: string | null }): number {
  const total = o.total ?? 0;
  const isCash = o.bill_type === "cash";
  // Invoice: exclusive GST only when the owner pinned exclusive. Null/inclusive = total already payable.
  const gstExclusive = !isCash && o.gst_mode === "exclusive";
  if (!gstExclusive) return Math.round(total / 100) * 100;
  const tax = Math.round((total * 3) / 100);
  return Math.round((total + tax) / 100) * 100;
}

export function isLiveSale(o: { status?: string | null; is_backorder?: boolean | null; cod_hold?: boolean | null }): boolean {
  const s = String(o.status ?? "").toLowerCase().replace(/[\s_]+/g, "");
  if (s === "cancelled" || s === "canceled" || s === "refunded" || s === "void") return false;
  if (o.is_backorder === true) return false;
  if (o.cod_hold === true) return false;
  return true;
}

/** India shop calendar — "this month" is August in Kolkata, not UTC. */
export function istMonthStartISO(now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return new Date(`${y}-${m}-01T00:00:00+05:30`).toISOString();
}

export function targetingRange(period: string, now = new Date()): { from?: string; label: string } {
  if (period === "all") return { label: "all time" };
  if (period === "30d") return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), label: "last 30 days" };
  if (period === "quarter") {
    const start = new Date(istMonthStartISO(now));
    start.setUTCMonth(start.getUTCMonth() - 2);
    return { from: start.toISOString(), label: "last 3 months" };
  }
  return { from: istMonthStartISO(now), label: "this month" };
}

/**
 * Attach a bill to directory row(s). Phone wins; otherwise every row with the same firm name
 * shares the spend so "Pooja Fashion" × 2 still shows the ₹46,000 bill on the row the owner opens.
 */
export function directoryIdsForOrder(
  o: { customer_id?: string | null; customer_name?: string | null; customer_phone?: string | null },
  dir: { id: string; name?: string | null; phone?: string | null }[],
): string[] {
  if (o.customer_id) {
    const self = dir.find((c) => c.id === o.customer_id);
    const key = directoryNameKey(self?.name ?? o.customer_name);
    if (key) {
      const same = dir.filter((c) => directoryNameKey(c.name) === key).map((c) => c.id);
      if (same.length) return same;
    }
    return [o.customer_id];
  }
  const p = phoneLast10(o.customer_phone);
  if (p) {
    const ids = dir.filter((c) => phoneLast10(c.phone) === p).map((c) => c.id);
    if (ids.length) return ids;
  }
  const key = directoryNameKey(o.customer_name);
  if (!key || isWalkInPlaceholder(o.customer_name, o.customer_phone)) return [];
  return dir.filter((c) => directoryNameKey(c.name) === key).map((c) => c.id);
}
