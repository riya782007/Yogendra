export const dynamic = "force-dynamic";
import { getSuppliers, getProductsForPurchase, getRecentPurchases, getLastPurchaseCosts } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { PurchaseClient } from "@/components/admin/PurchaseClient";
import { createSupplierAction } from "@/app/actions/purchases";

export const metadata = { title: "Owner Console · Purchases" };

export default async function Purchases() {
  const [suppliers, products, purchases, lastCosts] = await Promise.all([getSuppliers(), getProductsForPurchase(), getRecentPurchases(), getLastPurchaseCosts()]);
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Purchases</h1>
      <p className="text-sm text-muted mb-6">Record supplier bills by city. Mapped items add to stock; the purchase ledger updates automatically.</p>

      <PurchaseClient suppliers={suppliers} products={products} lastCosts={lastCosts} />

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <h2 className="font-medium text-ink mb-3">Add supplier</h2>
          <form action={createSupplierAction} className="space-y-2">
            <input name="name" placeholder="Supplier name" className="w-full rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald" />
            <input name="city" placeholder="City (e.g. Mumbai)" className="w-full rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald" />
            <button className="btn-primary px-5 py-2 text-sm font-medium">Add</button>
          </form>
          <div className="mt-4 text-sm space-y-1">
            {suppliers.map((s: any) => <div key={s.id} className="flex justify-between border-b border-sand/50 py-1.5"><span className="text-ink">{s.name}</span><span className="text-muted text-xs">{s.city}</span></div>)}
          </div>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-card">
          <h2 className="font-medium text-ink mb-3">Recent purchases</h2>
          <table className="w-full text-sm">
            <thead className="text-muted text-left"><tr><th className="py-1">Bill</th><th className="py-1">Supplier</th><th className="py-1 text-right">Total</th></tr></thead>
            <tbody>
              {purchases.length === 0 && <tr><td colSpan={3} className="py-3 text-muted">No purchases yet.</td></tr>}
              {purchases.map((p: any) => (
                <tr key={p.id} className="border-t border-sand/50">
                  <td className="py-2"><a href={`/admin/purchase/${p.id}`} className="text-emerald nav-link">{p.bill_no || String(p.id).slice(0, 6).toUpperCase()} ↗</a></td>
                  <td className="py-2 text-muted">{p.supplier?.name}{p.supplier?.city ? ` · ${p.supplier.city}` : ""}</td>
                  <td className="py-2 text-right font-medium"><span className="sensitive">{formatPaise(p.total)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
