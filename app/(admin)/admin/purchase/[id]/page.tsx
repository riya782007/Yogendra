export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseById } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { getSession, can } from "@/lib/auth";
import { updatePurchaseAction, requestPurchaseDeletionAction } from "@/app/actions/purchases";

export const metadata = { title: "Owner Console · Purchase" };

export default async function PurchaseDetail({ params }: { params: { id: string } }) {
  const data = await getPurchaseById(params.id);
  if (!data) notFound();
  const { purchase: p, items, deletionPending, suppliers } = data;
  const canEdit = can(getSession(), "purchases.create");
  const ref = p.bill_no || String(p.id).slice(0, 8).toUpperCase();
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-3xl">
      <Link href="/admin/purchases" className="text-sm text-muted hover:text-ink">← Purchases</Link>
      <h1 className="font-display text-4xl text-ink mt-1">Purchase · {ref}</h1>
      <p className="text-sm text-muted mb-5">{p.supplier?.name}{p.supplier?.city ? ` · ${p.supplier.city}` : ""} · {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>

      {/* Items */}
      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card mb-5">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr><th className="p-3">Supplier item</th><th className="p-3">Mapped SKU</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit cost</th><th className="p-3 text-right">Line</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="p-3 text-muted">No line items.</td></tr>}
            {items.map((it: any, i: number) => (
              <tr key={i} className="border-t border-sand/60">
                <td className="p-3 text-ink">{it.supplier_sku || "—"}</td>
                <td className="p-3 text-muted">{it.product ? `${it.product.name} (${it.product.sku})` : <span className="text-rose">unmapped</span>}</td>
                <td className="p-3 text-right">{it.qty}</td>
                <td className="p-3 text-right">{formatPaise(it.unit_cost)}</td>
                <td className="p-3 text-right font-medium">{formatPaise(it.unit_cost * it.qty)}</td>
              </tr>
            ))}
            <tr className="bg-cream/50 font-semibold"><td className="p-3" colSpan={4}>Total</td><td className="p-3 text-right">{formatPaise(p.total)}</td></tr>
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="grid md:grid-cols-2 gap-4">
          {/* Edit metadata (low-risk, direct) */}
          <div className="bg-white rounded-2xl p-5 shadow-card">
            <h2 className="font-medium text-ink mb-3">Edit bill details</h2>
            <form action={updatePurchaseAction} className="space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <input name="bill_no" defaultValue={p.bill_no ?? ""} placeholder="Bill number" className={`${fld} w-full`} />
              <select name="supplier_id" defaultValue={p.supplier?.id ?? ""} className={`${fld} w-full`}>
                {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
              </select>
              <button className="btn-primary px-5 py-2.5 text-sm font-medium">Save</button>
            </form>
          </div>

          {/* Delete = sensitive → approval + OTP */}
          <div className="bg-white rounded-2xl p-5 shadow-card border border-rose/20">
            <h2 className="font-medium text-ink mb-1">Delete purchase</h2>
            <p className="text-xs text-muted mb-3">Deleting reverses the stock it added and the ledger entry. For safety this needs the <b>owner's OTP</b> on the Approvals page — it isn't applied instantly.</p>
            {deletionPending ? (
              <p className="text-sm text-gold-dark">⏳ Deletion requested — waiting for owner OTP on <Link href="/admin/approvals" className="nav-link text-emerald">Approvals</Link>.</p>
            ) : (
              <form action={requestPurchaseDeletionAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="bill_no" value={ref} />
                <button className="px-4 py-2 rounded-full bg-rose/10 text-rose text-sm hover:bg-rose/20">Request deletion (needs OTP)</button>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
