export const dynamic = "force-dynamic";
import Link from "next/link";
import { getStockMovements, getOpenEstimateReservations, getPendingHeldOrders } from "@/lib/supabase/queries";
import { Pager } from "@/components/admin/Pager";
import { StockMovementsTable } from "@/components/admin/StockMovementsTable";
import { getAdjustmentValueSummary, financialYearStart } from "@/lib/stockRecord";

export const metadata = { title: "Owner Console · Stock Movement History" };
const PAGE_SIZE = 30;

const KINDS = [
  { key: "all", label: "All movements" },
  { key: "sale", label: "Sales (out)" },
  { key: "purchase", label: "Purchases (in)" },
  { key: "opening", label: "Opening stock" },
  { key: "adjustment", label: "Adjustments & moves (by hand)" },
  { key: "move", label: "Stock moves (SKU → SKU)" },
  { key: "damage", label: "Damage / loss" },
  { key: "estimate", label: "Estimate reservations" },
  { key: "reserve", label: "On hold — reserved (out)" },
  { key: "release", label: "Hold released (in)" },
  { key: "return", label: "Sales returns (in)" },
  { key: "purchase_return", label: "Purchase returns (out)" },
];
// Row rendering, document links and click-to-open ledger now live in <StockMovementsTable/>.

export default async function StockMovements({ searchParams }: { searchParams: { page?: string; kind?: string; q?: string; from?: string; to?: string } }) {
  const page = parseInt(searchParams.page ?? "1", 10) || 1;
  const kind = searchParams.kind ?? "all";
  const q = searchParams.q ?? "";
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const [{ rows, total }, reservations, held, adjValue] = await Promise.all([
    getStockMovements({ page, pageSize: PAGE_SIZE, kind, q, from: from || undefined, to: to ? to + "T23:59:59" : undefined }),
    // #6: soft holds are a separate concept from the stock_adjustments ledger — show them on
    // every page (not only page 1) whenever the user is on the All or Estimate tab, so the
    // open-estimate reservations don't disappear as soon as you scroll.
    (kind === "all" || kind === "estimate") ? getOpenEstimateReservations() : Promise.resolve([] as any[]),
    // Backorders + COD-hold orders are committed stock-OUT that hasn't been deducted yet. Show them
    // on the All and Sales tabs so a pending outflow is never invisible (owner's request).
    (kind === "all" || kind === "sale") ? getPendingHeldOrders() : Promise.resolve([] as any[]),
    // Adjustments tab: rupee totals for the chosen dates (default: this financial year) — year-end tally.
    kind === "adjustment"
      ? getAdjustmentValueSummary(from ? new Date(from + "T00:00:00+05:30").toISOString() : financialYearStart(), to ? new Date(to + "T23:59:59+05:30").toISOString() : undefined)
      : Promise.resolve(null),
  ]);
  const inr = (paise: number) => `₹${Math.round(Math.abs(paise) / 100).toLocaleString("en-IN")}`;
  const reservedTotal = (reservations as any[]).reduce((s, e) => s + e.qty, 0);
  const heldTotal = (held as any[]).reduce((s, e) => s + e.qty, 0);
  const sel = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Stock Movement History</h1>
      <p className="text-sm text-muted mb-5">Every stock in &amp; out across all products. Click a row to open its purchase or sale bill.</p>

      <form action="/admin/stock-movements" className="flex flex-wrap gap-2 mb-4 items-center">
        <input name="q" defaultValue={q} placeholder="Search SKU…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[160px]" />
        <select name="kind" defaultValue={kind} className={sel}>{KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <label className="text-xs text-muted flex items-center gap-1">From <input type="date" name="from" defaultValue={from} className={sel} /></label>
        <label className="text-xs text-muted flex items-center gap-1">To <input type="date" name="to" defaultValue={to} className={sel} /></label>
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Filter</button>
        {(q || kind !== "all" || from || to) && <Link href="/admin/stock-movements" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>

      {reservations.length > 0 && (
        <div className="mb-5 rounded-2xl border border-gold/40 bg-gold/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-gold-dark">🔖 Reserved by open estimates — {reservedTotal} pcs across {reservations.length} quote{reservations.length > 1 ? "s" : ""}</h2>
            <span className="text-[11px] text-muted">Soft holds — stock only moves when the estimate is billed.</span>
          </div>
          <ul className="divide-y divide-gold/20">
            {(reservations as any[]).map((e) => (
              <li key={e.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <Link href={`/admin/estimate/${e.id}`} className="text-emerald nav-link font-medium">EST-{String(e.id).slice(0, 8).toUpperCase()} →</Link>
                  <span className="text-muted"> · {e.customer_name || "Walk-in"} · {new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                  <div className="text-xs text-muted mt-0.5 truncate">{e.lines.map((l: any) => `${l.name ?? l.sku}${l.color ? ` (${l.color})` : ""} ×${l.qty}${l.unitPrice != null ? ` @ ₹${Math.round(l.unitPrice / 100)}` : ""}`).join(", ")}</div>
                </div>
                <span className="text-gold-dark font-semibold whitespace-nowrap">{e.qty} pcs</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {held.length > 0 && (
        <div className="mb-5 rounded-2xl border border-rose/40 bg-rose/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <h2 className="text-sm font-semibold text-rose">📦 Pending stock-out (held orders) — {heldTotal} pcs across {held.length} order{held.length > 1 ? "s" : ""}</h2>
            <span className="text-[11px] text-muted">Backorders &amp; COD holds — stock only moves when you dispatch / fulfil.</span>
          </div>
          <ul className="divide-y divide-rose/20">
            {(held as any[]).map((o) => {
              const href = o.kind === "backorder" ? "/admin/backorders" : "/admin/cod";
              const tag = o.kind === "backorder" ? "BACKORDER" : "COD HOLD";
              const label = o.invoice_no || String(o.id).slice(0, 8).toUpperCase();
              return (
                <li key={o.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <Link href={href} className="text-emerald nav-link font-medium">{label} →</Link>
                    <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-rose">{tag}</span>
                    <span className="text-muted"> · {o.customer_name || "Customer"}{o.channel ? ` · ${o.channel}` : ""} · {new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                    <div className="text-xs text-muted mt-0.5 truncate">{o.lines.map((l: any) => `${l.name ?? l.sku}${l.color ? ` (${l.color})` : ""} ×${l.qty}`).join(", ")}</div>
                  </div>
                  <span className="text-rose font-semibold whitespace-nowrap">{o.qty} pcs</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {adjValue && (
        <div className="mb-5 rounded-2xl border border-sand bg-white p-4 shadow-card">
          <p className="text-sm font-semibold text-ink mb-2">🧾 Adjustment value — {from || to ? `${from || "start"} to ${to || "today"}` : `this financial year (from ${new Date(adjValue.from).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })})`}</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-[11px] uppercase tracking-wide text-muted">Added</p><p className="font-semibold text-emerald-dark tabular-nums">+{inr(adjValue.addedPaise)}</p><p className="text-[11px] text-muted">{adjValue.addedPcs} pcs</p></div>
            <div><p className="text-[11px] uppercase tracking-wide text-muted">Removed</p><p className="font-semibold text-rose tabular-nums">−{inr(adjValue.removedPaise)}</p><p className="text-[11px] text-muted">{adjValue.removedPcs} pcs</p></div>
            <div><p className="text-[11px] uppercase tracking-wide text-muted">Net effect</p><p className={`font-semibold tabular-nums ${adjValue.netPaise < 0 ? "text-rose" : "text-emerald-dark"}`}>{adjValue.netPaise < 0 ? "−" : "+"}{inr(adjValue.netPaise)} {adjValue.netPaise < 0 ? "loss" : adjValue.netPaise > 0 ? "gain" : ""}</p><p className="text-[11px] text-muted">{adjValue.rows} changes{adjValue.unpriced ? ` · ${adjValue.unpriced} without a rate` : ""}</p></div>
          </div>
          <p className="text-[11px] text-muted mt-2">Each change is valued at the piece's cost (base rate) — e.g. 2 pcs of a ₹32 piece missing = −₹64. Set From/To above for any period.</p>
        </div>
      )}

      <p className="text-xs text-muted mb-2">Tip: click any row to open the full <b>Product Stock Ledger</b> for that SKU.</p>
      <StockMovementsTable rows={rows as any} />
      <Pager basePath="/admin/stock-movements" params={{ q, kind, from, to }} page={page} pageSize={PAGE_SIZE} total={total} />
    </main>
  );
}
