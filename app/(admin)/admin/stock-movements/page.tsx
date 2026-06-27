export const dynamic = "force-dynamic";
import Link from "next/link";
import { getStockMovements, getOpenEstimateReservations } from "@/lib/supabase/queries";
import { Pager } from "@/components/admin/Pager";

export const metadata = { title: "Owner Console · Stock Movement History" };
const PAGE_SIZE = 30;

const KINDS = [
  { key: "all", label: "All movements" },
  { key: "sale", label: "Sales (out)" },
  { key: "purchase", label: "Purchases (in)" },
  { key: "opening", label: "Opening stock" },
  { key: "adjustment", label: "Adjustments" },
  { key: "damage", label: "Damage / loss" },
  { key: "estimate", label: "Estimate reservations" },
];
const KIND_STYLE: Record<string, string> = {
  sale: "bg-gold/15 text-gold-dark",
  purchase: "bg-emerald-mist text-emerald-dark",
  damage: "bg-rose/10 text-rose",
  opening: "bg-blue-100 text-blue-700",
  adjustment: "bg-cream text-muted",
  estimate: "bg-gold/10 text-gold-dark",
};

// Pillar 5 — every movement opens its source bill straight from this register.
function docFor(r: any): { href: string; label: string } | null {
  if (!r.ref_id) return null;
  if (r.kind === "sale") return { href: `/admin/invoice/${r.ref_id}`, label: "View bill →" };
  if (r.kind === "purchase") return { href: `/admin/purchase/${r.ref_id}`, label: "View purchase →" };
  // #6: the estimate row opens the specific quote it reserved stock for, not the list page.
  if (r.kind === "estimate") return { href: `/admin/estimate/${r.ref_id}`, label: "View estimate →" };
  return null;
}

export default async function StockMovements({ searchParams }: { searchParams: { page?: string; kind?: string; q?: string; from?: string; to?: string } }) {
  const page = parseInt(searchParams.page ?? "1", 10) || 1;
  const kind = searchParams.kind ?? "all";
  const q = searchParams.q ?? "";
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const [{ rows, total }, reservations] = await Promise.all([
    getStockMovements({ page, pageSize: PAGE_SIZE, kind, q, from: from || undefined, to: to ? to + "T23:59:59" : undefined }),
    // #6: soft holds are a separate concept from the stock_adjustments ledger — show them on
    // every page (not only page 1) whenever the user is on the All or Estimate tab, so the
    // open-estimate reservations don't disappear as soon as you scroll.
    (kind === "all" || kind === "estimate") ? getOpenEstimateReservations() : Promise.resolve([] as any[]),
  ]);
  const reservedTotal = (reservations as any[]).reduce((s, e) => s + e.qty, 0);
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
                  <div className="text-xs text-muted mt-0.5 truncate">{e.lines.map((l: any) => `${l.name ?? l.sku} ×${l.qty}`).join(", ")}</div>
                </div>
                <span className="text-gold-dark font-semibold whitespace-nowrap">{e.qty} pcs</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Date</th><th className="p-3">Item</th><th className="p-3">Type</th>
            <th className="p-3 text-right">Change</th><th className="p-3">Note</th><th className="p-3">Document</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-muted">No movements match these filters.</td></tr>}
            {rows.map((r: any) => {
              const doc = docFor(r);
              const colour = r.variant?.color as string | undefined;
              return (
                <tr key={r.id} className="border-t border-sand/60 hover:bg-cream/40">
                  <td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="p-3 text-ink">
                    {r.product?.name ?? "—"}
                    <span className="block text-xs text-muted">{r.sku ?? r.product?.sku}{colour ? ` · ${colour}` : ""}</span>
                  </td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${KIND_STYLE[r.kind] ?? "bg-cream text-muted"}`}>{r.kind ?? "—"}</span></td>
                  <td className={`p-3 text-right font-semibold tabular-nums ${r.delta > 0 ? "text-emerald-dark" : "text-rose"}`}>{r.delta > 0 ? "+" : ""}{r.delta}</td>
                  <td className="p-3 text-muted max-w-[260px] truncate">{r.source ?? ""}{r.reason ? ` — ${r.reason}` : ""}</td>
                  <td className="p-3">{doc ? <Link href={doc.href} className="text-emerald nav-link whitespace-nowrap text-xs">{doc.label}</Link> : <span className="text-muted text-xs">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager basePath="/admin/stock-movements" params={{ q, kind, from, to }} page={page} pageSize={PAGE_SIZE} total={total} />
    </main>
  );
}
