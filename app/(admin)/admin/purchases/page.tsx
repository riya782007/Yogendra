export const dynamic = "force-dynamic";
import { getSuppliers, getProductsForPurchaseCached, getPurchasesPage, getLastPurchaseCosts, getPaymentMethods } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { PurchaseClient } from "@/components/admin/PurchaseClient";
import { SupplierManager } from "@/components/admin/SupplierManager";
import { Pager } from "@/components/admin/Pager";

export const metadata = { title: "Owner Console · Purchases" };
const PAGE_SIZE = 25;
const sel = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

export default async function Purchases({ searchParams }: { searchParams: { page?: string; q?: string; supplier?: string; from?: string; to?: string } }) {
  const page = parseInt(searchParams.page ?? "1", 10) || 1;
  const q = searchParams.q ?? "";
  const supplier = searchParams.supplier ?? "all";
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";

  const [suppliers, products, lastCosts, methods, bills] = await Promise.all([
    getSuppliers(),
    getProductsForPurchaseCached(),
    getLastPurchaseCosts(),
    getPaymentMethods({ activeOnly: true }),
    getPurchasesPage({ page, pageSize: PAGE_SIZE, q, supplierId: supplier, from: from || undefined, to: to ? to + "T23:59:59" : undefined }),
  ]);

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Purchases</h1>
      <p className="text-sm text-muted mb-6">Record supplier bills by city. Every bill is in the register below — search or page through the full history, not only the latest ones.</p>

      <PurchaseClient suppliers={suppliers} products={products} lastCosts={lastCosts} methods={(methods as any[]).map((m) => ({ id: m.id, name: m.name, kind: m.kind }))} />

      <div className="grid md:grid-cols-2 gap-6 mb-6">
        <SupplierManager suppliers={suppliers.map((s: any) => ({ id: s.id, name: s.name, city: s.city ?? null }))} />
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-card">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="font-medium text-ink">All purchase bills</h2>
          <p className="text-xs text-muted">{bills.total} bill{bills.total === 1 ? "" : "s"}</p>
        </div>
        <form action="/admin/purchases" className="flex flex-wrap gap-2 mb-4 items-center">
          <input name="q" defaultValue={q} placeholder="Search bill no. or supplier…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[180px]" />
          <select name="supplier" defaultValue={supplier} className={sel}>
            <option value="all">All suppliers</option>
            {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
          </select>
          <label className="text-xs text-muted flex items-center gap-1">From <input type="date" name="from" defaultValue={from} className={sel} /></label>
          <label className="text-xs text-muted flex items-center gap-1">To <input type="date" name="to" defaultValue={to} className={sel} /></label>
          <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Search</button>
          {(q || supplier !== "all" || from || to) && <a href="/admin/purchases" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</a>}
        </form>
        <table className="w-full text-sm">
          <thead className="text-muted text-left"><tr>
            <th className="py-1">Date</th>
            <th className="py-1">Bill</th>
            <th className="py-1">Supplier</th>
            <th className="py-1 text-right">Total</th>
          </tr></thead>
          <tbody>
            {bills.rows.length === 0 && <tr><td colSpan={4} className="py-3 text-muted">No purchase bills match.</td></tr>}
            {bills.rows.map((p: any) => (
              <tr key={p.id} className="border-t border-sand/50">
                <td className="py-2 text-muted whitespace-nowrap">{p.created_at ? new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
                <td className="py-2"><a href={`/admin/purchase/${p.id}`} className="text-emerald nav-link">{p.bill_no || String(p.id).slice(0, 6).toUpperCase()} ↗</a></td>
                <td className="py-2 text-muted">{p.supplier?.name}{p.supplier?.city ? ` · ${p.supplier.city}` : ""}</td>
                <td className="py-2 text-right font-medium"><span className="sensitive">{formatPaise(p.total)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager basePath="/admin/purchases" params={{ q, supplier, from, to }} page={bills.page} pageSize={PAGE_SIZE} total={bills.total} />
      </div>
    </main>
  );
}
