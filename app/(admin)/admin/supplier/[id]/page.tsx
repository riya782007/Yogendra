export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupplierLedger } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";

export const metadata = { title: "Owner Console · Supplier ledger" };
const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";

export default async function SupplierLedger({ params }: { params: { id: string } }) {
  const data = await getSupplierLedger(params.id);
  if (!data) notFound();
  const { supplier, purchases, totalPurchased, totalQty } = data as any;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-4xl">
      <Link href="/admin/suppliers" className="text-sm text-muted hover:text-ink">← Suppliers</Link>
      <div className="flex items-center gap-3 mt-1 flex-wrap mb-1">
        <h1 className="font-display text-4xl text-ink">{supplier.name}</h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-mist text-emerald-dark capitalize">{supplier.kind}</span>
      </div>
      <p className="text-sm text-muted mb-5">
        {[supplier.city, supplier.state].filter(Boolean).join(", ") || "—"}
        {supplier.phone ? ` · ${supplier.phone}` : ""}{supplier.gstin ? ` · GSTIN ${supplier.gstin}` : ""}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Total purchased</p><p className="text-2xl font-semibold text-ink mt-1">{formatPaise(totalPurchased)}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Bills</p><p className="text-2xl font-semibold text-ink mt-1">{purchases.length}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Pieces in</p><p className="text-2xl font-semibold text-ink mt-1">{totalQty}</p></div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Bill</th><th className="p-3">Date</th><th className="p-3 text-right">Pieces</th><th className="p-3 text-right">Amount</th>
          </tr></thead>
          <tbody>
            {purchases.length === 0 && <tr><td colSpan={4} className="p-4 text-muted">No purchases recorded from this supplier yet.</td></tr>}
            {purchases.map((p: any) => (
              <tr key={p.id} className="border-t border-sand/60">
                <td className="p-3"><Link href={`/admin/purchase/${p.id}`} className="text-emerald nav-link font-medium">{p.bill_no || String(p.id).slice(0, 6).toUpperCase()} ↗</Link></td>
                <td className="p-3 text-muted whitespace-nowrap">{new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                <td className="p-3 text-right">{p.qty}</td>
                <td className="p-3 text-right font-medium">{formatPaise(p.total)}</td>
              </tr>
            ))}
          </tbody>
          {purchases.length > 0 && (
            <tfoot className="bg-cream/50 font-medium"><tr>
              <td className="p-3 text-ink" colSpan={2}>Total</td>
              <td className="p-3 text-right">{totalQty}</td>
              <td className="p-3 text-right">{formatPaise(totalPurchased)}</td>
            </tr></tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-muted mt-3">Every purchase bill from {supplier.name}. Click a bill to view its lines, or to edit/reverse it.</p>
    </main>
  );
}
