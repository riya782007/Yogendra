export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupplierLedger } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { setSupplierOpeningBalanceAction, recordSupplierPaymentAction, deleteSupplierPaymentAction } from "@/app/actions/suppliers";

export const metadata = { title: "Owner Console · Supplier ledger" };
const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";
const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

export default async function SupplierLedger({ params }: { params: { id: string } }) {
  const data = await getSupplierLedger(params.id);
  if (!data) notFound();
  const { supplier, purchases, payments, totalPurchased, totalQty, opening, totalPaid, balanceOwed } = data as any;

  // Combined chronological ledger with a running "balance owed".
  const events: any[] = [
    ...(opening > 0 ? [{ kind: "opening", date: supplier.created_at, debit: opening, credit: 0, label: "Opening balance", link: null }] : []),
    ...purchases.map((p: any) => ({ kind: "purchase", date: p.created_at, debit: p.total, credit: 0, label: `Purchase ${p.bill_no || String(p.id).slice(0, 6).toUpperCase()}`, link: `/admin/purchase/${p.id}` })),
    ...payments.map((p: any) => ({ kind: "payment", date: p.created_at, debit: 0, credit: p.amount, label: `Payment · ${p.mode}${p.ref ? ` · ${p.ref}` : ""}${p.note ? ` — ${p.note}` : ""}`, payId: p.id, link: null })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  let run = 0;
  const rows = events.map((e) => { run += e.debit - e.credit; return { ...e, balance: run }; });

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Opening</p><p className="text-xl font-semibold text-ink mt-1">{formatPaise(opening)}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Purchased</p><p className="text-xl font-semibold text-ink mt-1">{formatPaise(totalPurchased)}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Paid</p><p className="text-xl font-semibold text-ink mt-1">{formatPaise(totalPaid)}</p></div>
        <div className={`${card} ${balanceOwed > 0 ? "ring-1 ring-rose/40" : ""}`}>
          <p className="text-xs uppercase tracking-wide text-muted">{balanceOwed > 0 ? "We owe" : balanceOwed < 0 ? "Advance" : "Settled"}</p>
          <p className={`text-xl font-semibold mt-1 ${balanceOwed > 0 ? "text-rose" : "text-emerald-dark"}`}>{formatPaise(Math.abs(balanceOwed))}</p>
        </div>
      </div>

      {/* Opening balance + record payment */}
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <form action={setSupplierOpeningBalanceAction} className={`${card} flex items-end gap-2 flex-wrap`}>
          <input type="hidden" name="id" value={supplier.id} />
          <label className="text-[11px] text-muted">Opening balance ₹<input name="opening" type="number" min={0} step="0.01" defaultValue={opening ? (opening / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
          <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
        </form>
        <form action={recordSupplierPaymentAction} className={`${card} flex items-end gap-2 flex-wrap`}>
          <input type="hidden" name="id" value={supplier.id} />
          <label className="text-[11px] text-muted">Pay ₹<input name="amount" type="number" min={1} step="0.01" placeholder="0" className={`${inp} w-24 block mt-0.5`} /></label>
          <label className="text-[11px] text-muted">Mode<select name="mode" className={`${inp} block mt-0.5`}><option value="cash">Cash</option><option value="bank">Bank</option><option value="upi">UPI</option></select></label>
          <label className="text-[11px] text-muted">Ref<input name="ref" placeholder="cheque/UTR" className={`${inp} w-28 block mt-0.5`} /></label>
          <button className="btn-primary px-4 py-2 text-sm font-medium">Record payment</button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Date</th><th className="p-3">Description</th>
            <th className="p-3 text-right">Purchases</th><th className="p-3 text-right">Paid</th><th className="p-3 text-right">Balance</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-muted">No activity yet. Set an opening balance or record a purchase/payment.</td></tr>}
            {rows.map((e: any, i: number) => (
              <tr key={i} className="border-t border-sand/60">
                <td className="p-3 text-muted whitespace-nowrap">{new Date(e.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                <td className="p-3 text-ink">{e.link ? <Link href={e.link} className="text-emerald nav-link">{e.label} ↗</Link> : e.label}</td>
                <td className="p-3 text-right">{e.debit ? formatPaise(e.debit) : ""}</td>
                <td className="p-3 text-right text-emerald-dark">{e.credit ? formatPaise(e.credit) : ""}</td>
                <td className={`p-3 text-right font-medium ${e.balance > 0 ? "text-rose" : "text-ink"}`}>{formatPaise(e.balance)}</td>
                <td className="p-3 text-right">{e.payId && (
                  <form action={deleteSupplierPaymentAction} className="inline">
                    <input type="hidden" name="id" value={e.payId} /><input type="hidden" name="supplier_id" value={supplier.id} />
                    <button className="text-muted hover:text-rose text-xs" title="Delete payment">✕</button>
                  </form>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted mt-3">{totalQty} pieces received across {purchases.length} bills. A positive balance means money still payable to {supplier.name}.</p>
    </main>
  );
}
