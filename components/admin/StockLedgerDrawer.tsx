"use client";
/**
 * StockLedgerDrawer — the per-SKU Product Stock Ledger (SAP/Zoho/Tally-style).
 * Opens from a Stock Movement row WITHOUT navigating away. Lazy-loads + paginates the SKU's
 * full inventory history with running balances, reservations, analytics, filters, search,
 * related-document links and CSV/print export.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { fetchProductLedgerAction } from "@/app/actions/ledger";

type Movement = {
  id: string; kind: string; delta: number; runningBalance: number;
  source: string | null; reason: string | null; created_by: string | null;
  ref_id: string | null; created_at: string; invoice_no?: string | null;
  party?: string | null;
  variant?: { color: string | null; sku: string | null } | null;
  doc: { href: string; label: string } | null;
};
type VariantSummary = { id: string; sku: string; color: string | null; qty: number; purchased: number; sold: number; net: number };
type Ledger = {
  header: { id: string; sku: string; name: string; image: string | null; category: string | null;
    supplier: string | null; currentStock: number; reserved: number; available: number;
    reorderLevel: number | null; avgCost: number | null; lastPurchaseCost: number | null;
    lastSaleDate: string | null; lastPurchaseDate: string | null };
  analytics: { opening: number; purchased: number; sold: number; returned: number; adjusted: number;
    reserved: number; available: number; currentStock: number; daysSinceLastSale: number | null;
    turnover: number; avgMonthlySales: number };
  reservations: { id: string; customer: string; qty: number; status: string; created_at: string }[];
  variants: VariantSummary[];
  movements: Movement[];
  totalMovements: number;
  nextOffset: number | null;
};

const PAGE = 50;
const fmt = (p: number | null | undefined) => (p == null ? "—" : `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

const KIND_STYLE: Record<string, string> = {
  sale: "bg-gold/15 text-gold-dark", purchase: "bg-emerald-mist text-emerald-dark",
  damage: "bg-rose/10 text-rose", opening: "bg-blue-100 text-blue-700",
  adjustment: "bg-cream text-muted", estimate: "bg-gold/10 text-gold-dark",
  return: "bg-violet-50 text-violet-700", correction: "bg-cream text-muted",
  transfer: "bg-sky-50 text-sky-700",
};
const FILTERS: { key: string; label: string; kinds: string[] }[] = [
  { key: "all", label: "All", kinds: [] },
  { key: "sale", label: "Sales", kinds: ["sale"] },
  { key: "purchase", label: "Purchases", kinds: ["purchase"] },
  { key: "estimate", label: "Estimates / Reservations", kinds: ["estimate"] },
  { key: "return", label: "Returns", kinds: ["return", "purchase_return", "replacement"] },
  { key: "adjustment", label: "Manual Adjustments", kinds: ["adjustment", "damage", "correction"] },
  { key: "audit", label: "Inventory Audits", kinds: ["audit", "inventory_audit"] },
  { key: "transfer", label: "Transfers", kinds: ["transfer"] },
  { key: "opening", label: "Opening / Import", kinds: ["opening", "import", "bulk_upload"] },
];

export function StockLedgerDrawer({ productId, onClose }: { productId: string; onClose: () => void }) {
  const [data, setData] = useState<Ledger | null>(null);
  const [rows, setRows] = useState<Movement[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState("all");
  const [colour, setColour] = useState(""); // "" = all colours; else filter movements to that variant colour
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    let alive = true;
    setLoading(true); setData(null); setRows([]);
    fetchProductLedgerAction(productId, { offset: 0, limit: PAGE }).then((d) => {
      if (!alive || !d) { if (alive) setLoading(false); return; }
      setData(d as Ledger); setRows((d as Ledger).movements); setNextOffset((d as Ledger).nextOffset); setLoading(false);
    });
    return () => { alive = false; };
  }, [productId]);

  const loadMore = useCallback(async () => {
    if (nextOffset == null) return;
    setLoadingMore(true);
    const d = await fetchProductLedgerAction(productId, { offset: nextOffset, limit: PAGE });
    if (d) { setRows((r) => [...r, ...(d as Ledger).movements]); setNextOffset((d as Ledger).nextOffset); }
    setLoadingMore(false);
  }, [nextOffset, productId]);

  // Client-side filter + search over the loaded pages.
  const filtered = useMemo(() => {
    const kinds = FILTERS.find((f) => f.key === filter)?.kinds ?? [];
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (kinds.length && !kinds.includes(r.kind)) return false;
      if (colour && (r.variant?.color ?? "") !== colour) return false;
      if (from && r.created_at < from) return false;
      if (to && r.created_at > to + "T23:59:59") return false;
      if (!s) return true;
      return [r.invoice_no, r.ref_id, r.source, r.reason, r.created_by, r.kind, r.party, r.variant?.color, r.variant?.sku].some((v) => (v ?? "").toString().toLowerCase().includes(s));
    });
  }, [rows, filter, colour, q, from, to]);

  // Group by calendar day, with that day's closing balance (newest row's running balance).
  const groups = useMemo(() => {
    const m = new Map<string, Movement[]>();
    for (const r of filtered) { const k = day(r.created_at); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()];
  }, [filtered]);

  function exportCsv() {
    const head = ["Date", "Time", "Type", "Change", "Balance", "Invoice/Bill", "Party", "Reference", "By", "Note"];
    const lines = rows.map((r) => [day(r.created_at), time(r.created_at), r.kind, r.delta, r.runningBalance,
      r.invoice_no ?? "", r.party ?? "", r.ref_id ?? "", r.created_by ?? "", (r.reason ?? r.source ?? "").replace(/[\n,]/g, " ")]);
    const csv = [head, ...lines].map((row) => row.map((c) => `"${String(c)}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = `ledger-${data?.header.sku ?? productId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const h = data?.header;
  const a = data?.analytics;

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-ivory shadow-luxe flex flex-col animate-[fadeIn_.2s_ease]">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-sand bg-white">
          <div className="w-16 h-16 rounded-xl bg-cream overflow-hidden shrink-0">
            {h?.image ? <img src={h.image} alt={h.name} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-muted text-xs">No image</div>}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-display text-xl text-ink leading-tight truncate">{h?.name ?? "Loading…"}</p>
            <p className="text-xs text-muted">{h?.sku} · {h?.category ?? "—"} {h?.supplier ? `· ${h.supplier}` : ""}</p>
            {h && (
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-[11px]">
                <span className="text-ink">Stock <b>{h.currentStock}</b></span>
                <span className="text-gold-dark">Reserved <b>{h.reserved}</b></span>
                <span className="text-emerald-dark">Available <b>{h.available}</b></span>
                <span className="text-muted">Reorder {h.reorderLevel ?? "—"}</span>
                <span className="text-muted">Avg cost {fmt(h.avgCost)}</span>
                <span className="text-muted">Last buy {fmt(h.lastPurchaseCost)}</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="text-xl text-muted hover:text-ink leading-none">✕</button>
        </div>

        {loading ? (
          <div className="flex-1 grid place-items-center text-muted text-sm">Loading ledger…</div>
        ) : !data ? (
          <div className="flex-1 grid place-items-center text-muted text-sm">No ledger found.</div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Analytics cards */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 p-4">
              {[
                ["Opening", a!.opening], ["Purchased", a!.purchased], ["Sold", a!.sold], ["Returned", a!.returned],
                ["Adjusted", a!.adjusted], ["Reserved", a!.reserved], ["Available", a!.available], ["Current", a!.currentStock],
              ].map(([label, val]) => (
                <div key={label as string} className="bg-white rounded-xl border border-sand p-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted">{label as string}</p>
                  <p className="text-lg font-semibold text-ink">{val as number}</p>
                </div>
              ))}
              <div className="bg-white rounded-xl border border-sand p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted">Days since sale</p><p className="text-lg font-semibold text-ink">{a!.daysSinceLastSale ?? "—"}</p></div>
              <div className="bg-white rounded-xl border border-sand p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted">Turnover</p><p className="text-lg font-semibold text-ink">{a!.turnover}×</p></div>
              <div className="bg-white rounded-xl border border-sand p-2.5"><p className="text-[10px] uppercase tracking-wide text-muted">Avg/month</p><p className="text-lg font-semibold text-ink">{a!.avgMonthlySales}</p></div>
            </div>

            {/* Reservation panel */}
            {data.reservations.length > 0 && (
              <div className="mx-4 mb-3 rounded-xl border border-gold/40 bg-gold/5 p-3">
                <p className="text-xs font-semibold text-gold-dark mb-1.5">🔖 Reserved by estimates · {h!.reserved} pcs · available after reservation {h!.available}</p>
                <ul className="divide-y divide-gold/20">
                  {data.reservations.map((r) => (
                    <li key={r.id} className="py-1.5 flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate"><Link href={`/admin/estimate/${r.id}`} className="text-emerald nav-link font-medium">EST-{r.id.slice(0, 8).toUpperCase()}</Link> · {r.customer} · {day(r.created_at)}</span>
                      <span className="text-gold-dark font-semibold whitespace-nowrap">{r.qty} pcs · {r.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* By colour / variant — the movement of every variant so the owner can decide per colour. */}
            {data.variants.length > 0 && (
              <div className="mx-4 mb-3 rounded-xl border border-sand bg-white p-3">
                <p className="text-xs font-semibold text-ink mb-2">By colour · tap to filter the timeline below</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <button onClick={() => setColour("")} className={`rounded-lg border p-2 text-left ${colour === "" ? "border-emerald ring-1 ring-emerald/40" : "border-sand hover:border-gold"}`}>
                    <p className="text-[11px] font-medium text-ink">All colours</p>
                    <p className="text-[10px] text-muted">Stock {h!.currentStock} · sold {a!.sold} · bought {a!.purchased}</p>
                  </button>
                  {data.variants.map((v) => (
                    <button key={v.id} onClick={() => setColour((c) => (c === (v.color ?? "") ? "" : (v.color ?? "")))}
                      className={`rounded-lg border p-2 text-left ${colour === (v.color ?? "") && colour !== "" ? "border-emerald ring-1 ring-emerald/40" : "border-sand hover:border-gold"}`}>
                      <p className="text-[11px] font-medium text-ink truncate">{v.color ?? "—"} <span className="font-mono text-[9px] text-muted">{v.sku}</span></p>
                      <p className="text-[10px] text-muted">Stock <b className={v.qty <= 2 ? "text-rose" : "text-ink"}>{v.qty}</b> · sold {v.sold} · bought {v.purchased}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Filters + search + export */}
            <div className="px-4 sticky top-0 bg-ivory/95 backdrop-blur py-2 border-y border-sand z-10">
              <div className="flex flex-wrap gap-1.5 mb-2">
                {FILTERS.map((f) => (
                  <button key={f.key} onClick={() => setFilter(f.key)} className={`px-2.5 py-1 rounded-full text-[11px] ${filter === f.key ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`}>{f.label}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search invoice, customer, ref, user…" className="flex-1 min-w-[160px] rounded-lg border border-sand bg-white px-3 py-1.5 text-xs outline-none focus:border-emerald" />
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-sand bg-white px-2 py-1.5 text-xs" />
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-sand bg-white px-2 py-1.5 text-xs" />
                <button onClick={exportCsv} className="px-2.5 py-1.5 rounded-lg bg-white border border-sand text-xs text-ink hover:border-emerald">⬇ CSV</button>
                <button onClick={() => window.print()} className="px-2.5 py-1.5 rounded-lg bg-white border border-sand text-xs text-ink hover:border-emerald">🖨 PDF</button>
              </div>
            </div>

            {/* Grouped timeline with running balance */}
            <div className="p-4 space-y-4">
              {groups.length === 0 && <p className="text-sm text-muted text-center py-8">No movements match these filters.</p>}
              {groups.map(([d, items]) => (
                <div key={d}>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-xs font-semibold text-ink">{d}</p>
                    <p className="text-[11px] text-muted">Closing balance <b className="text-ink">{items[0]?.runningBalance}</b></p>
                  </div>
                  <div className="rounded-xl border border-sand bg-white divide-y divide-sand/60">
                    {items.map((r) => (
                      <div key={r.id} className="p-2.5 flex items-center gap-3 text-sm">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] capitalize ${KIND_STYLE[r.kind] ?? "bg-cream text-muted"}`}>{r.kind}</span>
                        {r.variant?.color && <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-cream text-ink border border-sand whitespace-nowrap">{r.variant.color}</span>}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-ink truncate">{r.invoice_no ? <b>{r.invoice_no} · </b> : ""}{r.reason ?? r.source ?? "—"}</p>
                          <p className="text-[10px] text-muted">
                            {r.party && <b className="text-ink">{r.kind === "purchase" ? "From" : "To"} {r.party}</b>}
                            {r.party ? " · " : ""}{time(r.created_at)}{r.created_by ? ` · ${r.created_by}` : ""}{r.doc ? " · " : ""}{r.doc && <Link href={r.doc.href} className="text-emerald nav-link">{r.doc.label}</Link>}
                          </p>
                        </div>
                        <span className={`font-semibold tabular-nums ${r.delta > 0 ? "text-emerald-dark" : "text-rose"}`}>{r.delta > 0 ? "+" : ""}{r.delta}</span>
                        <span className="text-xs text-muted tabular-nums w-14 text-right">→ {r.runningBalance}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {nextOffset != null && (
                <button onClick={loadMore} disabled={loadingMore} className="w-full py-2 rounded-xl border border-sand text-sm text-muted hover:border-emerald disabled:opacity-50">
                  {loadingMore ? "Loading…" : `Load more (${data.totalMovements - rows.length} older)`}
                </button>
              )}
              <p className="text-[11px] text-muted text-center">Showing {filtered.length} of {data.totalMovements} movements</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
