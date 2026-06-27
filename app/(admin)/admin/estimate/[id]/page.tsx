export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEstimate, getProductsLite } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { PrintButton } from "@/components/admin/PrintButton";
import { BUSINESS, amountInWords } from "@/lib/business";
import { requirePerm } from "@/lib/auth";
import { updateEstimateCustomerAction, updateEstimateLineAction, updateEstimateLinePriceAction, removeEstimateLineAction, addEstimateLineAction } from "@/app/actions/billing";

export const metadata = { title: "Estimate / Quotation" };

export default async function EstimatePrint({ params }: { params: { id: string } }) {
  const data = await getEstimate(params.id);
  if (!data) notFound();
  const { estimate, items } = data;
  const isOpen = estimate.status === "open";
  const canEdit = isOpen && (await requirePerm("estimates.create"));
  const products = canEdit ? await getProductsLite() : [];
  const total = estimate.total as number;
  const ref = "EST-" + String(estimate.id).slice(0, 8).toUpperCase();
  const date = new Date(estimate.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const qtyTotal = items.reduce((s: number, it: any) => s + it.qty, 0);
  const th = "py-2 px-2 text-xs font-semibold text-ink/70";
  const td = "py-2 px-2 align-top";
  const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Link href="/admin/estimates" className="text-sm text-emerald nav-link">← Estimates</Link>
          <div className="flex items-center gap-2">
            {canEdit && <a href="#edit-estimate" className="px-4 py-2 rounded-full bg-emerald-mist text-emerald-dark text-sm font-medium hover:bg-emerald/20">✏️ Edit items &amp; prices</a>}
            <PrintButton />
          </div>
        </div>
        {!isOpen && (
          <div className="no-print mb-4 rounded-2xl border border-gold/40 bg-gold/5 p-3 text-sm text-gold-dark">
            This estimate is <b className="capitalize">{String(estimate.status).replace("_", " ")}</b>, so its items and prices are locked.
            {estimate.order_id && <> View the <Link href={`/admin/invoice/${estimate.order_id}`} className="text-emerald nav-link">billed invoice →</Link></>}
            {(estimate.status === "denied" || estimate.status === "expired") && <> Re-open it from the <Link href="/admin/estimates" className="text-emerald nav-link">Estimates list</Link> to edit again.</>}
          </div>
        )}

        <div className="print-area bg-white rounded-2xl shadow-card p-5 sm:p-8 text-[13px]" id="estimate">
          <div className="text-center pb-3 mb-3 border-b-2 border-ink/80">
            <p className="text-[15px] font-bold tracking-wide text-ink">ESTIMATE / QUOTATION</p>
            <p className="text-[10px] text-muted">This is not a tax invoice. Prices valid for 7 days.</p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 border border-sand rounded-lg overflow-hidden">
            <div className="p-4 border-b sm:border-b-0 sm:border-r border-sand">
              <p className="font-display text-2xl text-ink leading-none">{BUSINESS.brand}</p>
              <p className="text-xs text-muted mt-0.5">{BUSINESS.legalName}</p>
              <p className="text-xs text-muted mt-1">{BUSINESS.address}</p>
              <p className="text-xs text-muted">{BUSINESS.phone} · {BUSINESS.email}</p>
            </div>
            <div className="p-4 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted">Estimate No.</span><span className="font-medium text-ink">{ref}</span></div>
              <div className="flex justify-between"><span className="text-muted">Date</span><span className="text-ink">{date}</span></div>
              <div className="flex justify-between"><span className="text-muted">Status</span><span className="text-ink capitalize">{String(estimate.status).replace("_", " ")}</span></div>
            </div>
          </div>

          <div className="border border-t-0 border-sand rounded-b-lg p-4 -mt-px">
            <p className="text-[10px] uppercase tracking-wide text-muted mb-1">Prepared for</p>
            <p className="text-ink font-medium">{estimate.customer_name || "—"}</p>
            {estimate.customer_phone && <p className="text-muted text-xs">Ph: {estimate.customer_phone}</p>}
          </div>

          <table className="w-full mt-4 border border-sand">
            <thead className="bg-cream border-b border-sand">
              <tr className="text-left">
                <th className={th}>#</th><th className={th}>Description</th>
                <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Rate</th><th className={`${th} text-right`}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => (
                <tr key={i} className="border-b border-sand/60">
                  <td className={`${td} text-muted`}>{i + 1}</td>
                  <td className={`${td} text-ink`}>{it.product?.name}<span className="text-muted text-xs"> · {it.product?.sku}</span></td>
                  <td className={`${td} text-right`}>{it.qty}</td>
                  <td className={`${td} text-right`}>{formatPaise(it.unit_price)}</td>
                  <td className={`${td} text-right`}>{formatPaise(it.line_total)}</td>
                </tr>
              ))}
              <tr className="bg-cream/50 font-medium">
                <td className={td}></td><td className={`${td} text-ink`}>Total</td>
                <td className={`${td} text-right`}>{qtyTotal}</td><td className={td}></td>
                <td className={`${td} text-right`}>{formatPaise(total)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-4 text-xs">
            <p className="text-muted mb-1">Amount in words</p>
            <p className="text-ink font-medium">{amountInWords(total)}</p>
          </div>

          <p className="text-center text-[10px] text-muted mt-6 border-t border-sand pt-3">
            Estimate only — stock is reserved on confirmation. {BUSINESS.brand} · {BUSINESS.phone}
          </p>
        </div>

        {/* #18: edit panel — only for OPEN estimates (locks once billed) */}
        {canEdit && (
          <div id="edit-estimate" className="no-print mt-5 bg-white rounded-2xl shadow-card p-5 scroll-mt-4 ring-1 ring-emerald/20">
            <h2 className="font-medium text-ink mb-1">Edit estimate · items &amp; prices</h2>
            <p className="text-xs text-muted mb-4">This estimate is open — change items, quantities, the <b>per-line rate</b> (use this to give a discount), or the customer. Tap <b>Save rate</b> after editing a price. It locks once billed.</p>
            <datalist id="est-skus">{products.map((p: any) => <option key={p.id} value={p.sku}>{p.name}</option>)}</datalist>

            <form action={updateEstimateCustomerAction} className="flex flex-wrap items-end gap-2 mb-4">
              <input type="hidden" name="id" value={estimate.id} />
              <label className="text-[11px] text-muted">Customer<input name="customer_name" defaultValue={estimate.customer_name ?? ""} className={`${inp} w-44 block mt-0.5`} /></label>
              <label className="text-[11px] text-muted">Phone<input name="customer_phone" defaultValue={estimate.customer_phone ?? ""} className={`${inp} w-36 block mt-0.5`} /></label>
              <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-xs hover:bg-ink/10">Save customer</button>
            </form>

            <div className="space-y-2 mb-3">
              {items.map((it: any) => (
                <form key={it.id} action={updateEstimateLineAction} className="flex items-end gap-2">
                  <input type="hidden" name="item_id" value={it.id} />
                  <input type="hidden" name="estimate_id" value={estimate.id} />
                  <span className="flex-1 text-sm text-ink truncate self-center">{it.product?.name} <span className="text-muted font-mono text-xs">{it.product?.sku}</span></span>
                  <label className="text-[11px] text-muted">Qty<input name="qty" type="number" min={1} defaultValue={it.qty} className={`${inp} w-16 text-center block mt-0.5`} /></label>
                  <label className="text-[11px] text-muted">Rate ₹<input name="price" type="number" min={0} step="0.01" defaultValue={(it.unit_price / 100).toFixed(2)} className={`${inp} w-24 text-right block mt-0.5`} /></label>
                  <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-xs hover:bg-ink/10">Save qty</button>
                  <button formAction={updateEstimateLinePriceAction} className="px-3 py-2 rounded-xl bg-emerald-mist text-emerald-dark text-xs hover:bg-emerald/20">Save rate</button>
                  <button formAction={removeEstimateLineAction} className="text-muted hover:text-rose text-xs px-1 self-center">Remove</button>
                </form>
              ))}
              {items.length === 0 && <p className="text-sm text-muted">No items — add one below.</p>}
            </div>

            <form action={addEstimateLineAction} className="flex items-end gap-2 border-t border-sand/60 pt-3">
              <input type="hidden" name="estimate_id" value={estimate.id} />
              <label className="text-[11px] text-muted">Add SKU<input name="sku" list="est-skus" placeholder="BD1001" className={`${inp} w-40 block mt-0.5 font-mono`} /></label>
              <label className="text-[11px] text-muted">Qty<input name="qty" type="number" min={1} defaultValue={1} className={`${inp} w-16 text-center block mt-0.5`} /></label>
              <button className="btn-primary px-4 py-2 text-sm font-medium">+ Add item</button>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}
