export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPurchaseById } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { getSession, can } from "@/lib/auth";
import { updatePurchaseAction, requestPurchaseDeletionAction, mapPurchaseLineAction } from "@/app/actions/purchases";
import { PurchaseReturnButton } from "@/components/admin/PurchaseReturnButton";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Owner Console · Purchase" };

export default async function PurchaseDetail({ params }: { params: { id: string } }) {
  const data = await getPurchaseById(params.id);
  if (!data) notFound();
  const { purchase: p, items, deletionPending, suppliers, products } = data;
  // Returns already made to the supplier against this bill (debit notes).
  const { data: pRets } = await supabaseServer().from("returns").select("id,qty,amount,reason,created_at").eq("kind", "purchase").eq("ref_order_id", params.id).order("created_at", { ascending: false });
  const purchaseReturns = ((pRets as any[]) ?? []);
  const canEdit = can(getSession(), "purchases.create");
  const ref = p.bill_no || String(p.id).slice(0, 8).toUpperCase();
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-3xl">
      <Link href="/admin/purchases" className="text-sm text-muted hover:text-ink">← Purchases</Link>
      <div className="flex flex-wrap items-center justify-between gap-2 mt-1">
        <h1 className="font-display text-4xl text-ink">Purchase · {ref}</h1>
        {canEdit && <PurchaseReturnButton purchaseId={String(p.id)} billNo={p.bill_no} />}
      </div>
      <p className="text-sm text-muted mb-2">{p.supplier?.name}{p.supplier?.city ? ` · ${p.supplier.city}` : ""} · {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</p>
      {purchaseReturns.length > 0 && (
        <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4 mb-4 text-sm">
          <p className="font-medium text-gold-dark mb-1">↩ Returns to supplier against this bill</p>
          <ul className="divide-y divide-gold/20">
            {purchaseReturns.map((r: any) => (
              <li key={r.id} className="py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                <span className="text-ink">{r.qty} pc{r.qty === 1 ? "" : "s"}</span>
                {(r.amount ?? 0) > 0 && <span className="text-ink font-medium tabular-nums">debit note {formatPaise(r.amount)}</span>}
                {r.reason && <span className="text-muted truncate">— {r.reason}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Items */}
      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card mb-5">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr><th className="p-3">Supplier item</th><th className="p-3">Mapped SKU</th><th className="p-3 text-right">Qty</th><th className="p-3 text-right">Unit cost</th><th className="p-3 text-right">Line</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={5} className="p-3 text-muted">No line items.</td></tr>}
            {items.map((it: any, i: number) => (
              <tr key={i} className="border-t border-sand/60">
                <td className="p-3 text-ink">{it.supplier_sku || "—"}</td>
                <td className="p-3 text-muted">
                  {it.product ? (
                    <>
                      {it.product.name}{it.variant?.color ? <span className="text-ink"> – {it.variant.color}</span> : ""}{" "}
                      <span className="font-mono text-xs text-ink/70">({it.variant?.sku ?? it.product.sku})</span>
                    </>
                  ) : canEdit ? (
                    <form action={mapPurchaseLineAction} className="flex items-center gap-1.5">
                      <input type="hidden" name="line_id" value={it.id} />
                      <input type="hidden" name="purchase_id" value={p.id} />
                      <select name="product_id" required defaultValue="" className="rounded-lg border border-rose/40 bg-white px-2 py-1 text-xs outline-none focus:border-emerald max-w-[180px]">
                        <option value="" disabled>Map to design…</option>
                        {(products as any[]).map((pr) => <option key={pr.id} value={pr.id}>{pr.name} ({pr.sku})</option>)}
                      </select>
                      <button className="text-xs px-2 py-1 rounded-full bg-emerald text-white hover:bg-emerald-dark whitespace-nowrap" title="Map this line and add its stock to inventory">Map</button>
                    </form>
                  ) : <span className="text-rose">unmapped</span>}
                </td>
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
