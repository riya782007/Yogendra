export const dynamic = "force-dynamic";
import { getSuppliers, getProductsForPurchaseCached, getRecentPurchases, getLastPurchaseCosts, getPaymentMethods } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { PurchaseClient } from "@/components/admin/PurchaseClient";
import { SupplierManager } from "@/components/admin/SupplierManager";

export const metadata = { title: "Owner Console · Purchases" };

export default async function Purchases() {
  const [suppliers, products, purchases, lastCosts, methods] = await Promise.all([getSuppliers(), getProductsForPurchaseCached(), getRecentPurchases(), getLastPurchaseCosts(), getPaymentMethods({ activeOnly: true })]);
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Purchases</h1>
      <p className="text-sm text-muted mb-6">Record supplier bills by city. Mapped items add to stock; the purchase ledger updates automatically.</p>

      <PurchaseClient suppliers={suppliers} products={products} lastCosts={lastCosts} methods={(methods as any[]).map((m) => ({ id: m.id, name: m.name, kind: m.kind }))} />

      <div className="grid md:grid-cols-2 gap-6">
        <SupplierManager suppliers={suppliers.map((s: any) => ({ id: s.id, name: s.name, city: s.city ?? null }))} />

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
