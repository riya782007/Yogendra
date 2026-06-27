export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCustomerById } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { getSession, can } from "@/lib/auth";
import { upsertCustomerAction, deleteCustomerAction } from "@/app/actions/customers";
import { approveWholesaleAction, regenWholesaleCodeAction } from "@/app/actions/wholesale";

export const metadata = { title: "Owner Console · Customer" };

export default async function CustomerDetail({ params }: { params: { id: string } }) {
  const data = await getCustomerById(params.id);
  if (!data) notFound();
  const { customer: c, orders, totalSpent, orderCount, outstanding, creditAdjustment } = data;
  const canManage = can(getSession(), "customers.manage");
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald w-full";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-4xl">
      <Link href="/admin/customers" className="text-sm text-muted hover:text-ink">← Customers</Link>
      <div className="flex items-center gap-3 mt-1 mb-5">
        <h1 className="font-display text-4xl text-ink">{c.name}</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${c.type === "wholesale" ? "bg-gold/15 text-gold-dark" : "bg-emerald-mist text-emerald-dark"}`}>{c.type}</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl p-4 shadow-card"><p className="text-xs uppercase tracking-wide text-muted">Orders</p><p className="text-xl font-semibold mt-1">{orderCount}</p></div>
        <div className="bg-white rounded-2xl p-4 shadow-card"><p className="text-xs uppercase tracking-wide text-muted">Total spent</p><p className="text-xl font-semibold mt-1 text-emerald">{formatPaise(totalSpent)}</p></div>
        {/* Pillar 8 — "Outstanding" is now computed live from unpaid/partial bills, not a
            manual field. The manual `credit_balance` column is kept as an explicit
            adjustment (advance / store credit) below the headline tile. */}
        <div className="bg-white rounded-2xl p-4 shadow-card">
          <p className="text-xs uppercase tracking-wide text-muted">Outstanding <span className="text-[10px] opacity-70">(from bills)</span></p>
          <p className={`text-xl font-semibold mt-1 ${outstanding > 0 ? "text-rose" : "text-ink"}`}>{formatPaise(outstanding)}</p>
          {creditAdjustment !== 0 && (
            <p className={`text-[11px] mt-1 ${creditAdjustment > 0 ? "text-rose/80" : "text-emerald-dark"}`}>
              {creditAdjustment > 0 ? "+ " : "− "}{formatPaise(Math.abs(creditAdjustment))} manual adj.
            </p>
          )}
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-card"><p className="text-xs uppercase tracking-wide text-muted">GSTIN</p><p className="text-sm font-medium mt-1 break-all">{c.gstin || "—"}</p></div>
      </div>

      {/* Wholesale access */}
      {c.type === "wholesale" && canManage && (
        <div className="bg-white rounded-2xl p-5 shadow-card mb-4 border border-gold/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-medium text-ink">Wholesale portal access</h2>
              <p className="text-xs text-muted">{c.wholesale_approved ? "Approved — this retailer can sign in at /wholesale and see trade prices." : "Not approved yet — approve to issue an access code."}</p>
              {c.wholesale_approved && (
                <p className="text-sm mt-2">Login: <b>{c.phone || "set a phone first"}</b> · Access code: <span className="font-mono tracking-widest bg-ink/5 px-2 py-0.5 rounded">{c.login_code ?? "—"}</span></p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {c.wholesale_approved && (
                <form action={regenWholesaleCodeAction}><input type="hidden" name="id" value={c.id} /><button className="px-3 py-1.5 rounded-full bg-ink/5 text-ink text-xs hover:bg-ink/10">↻ New code</button></form>
              )}
              <form action={approveWholesaleAction}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="approve" value={c.wholesale_approved ? "0" : "1"} />
                <button className={`px-4 py-1.5 rounded-full text-xs font-medium ${c.wholesale_approved ? "bg-rose/10 text-rose hover:bg-rose/20" : "bg-emerald text-white hover:bg-emerald-dark"}`}>{c.wholesale_approved ? "Revoke access" : "Approve wholesale"}</button>
              </form>
            </div>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Profile / edit */}
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <h2 className="font-medium text-ink mb-3">Profile</h2>
          {canManage ? (
            <form action={upsertCustomerAction} className="space-y-3">
              <input type="hidden" name="id" value={c.id} />
              <div className="grid grid-cols-2 gap-3">
                <input name="name" defaultValue={c.name} className={fld} placeholder="Name" required />
                <select name="type" defaultValue={c.type} className={fld}><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select>
                <input name="phone" defaultValue={c.phone ?? ""} className={fld} placeholder="Phone" />
                <input name="email" defaultValue={c.email ?? ""} className={fld} placeholder="Email" />
                <input name="gstin" defaultValue={c.gstin ?? ""} className={fld} placeholder="GSTIN" />
                <input name="city" defaultValue={c.city ?? ""} className={fld} placeholder="City" />
                <input name="credit_balance" type="number" defaultValue={(c.credit_balance ?? 0) / 100} className={fld} placeholder="Manual adjustment ₹ (advance / store credit)" />
              </div>
              <textarea name="address" defaultValue={c.address ?? ""} className={fld} rows={2} placeholder="Address" />
              <textarea name="notes" defaultValue={c.notes ?? ""} className={fld} rows={2} placeholder="Notes" />
              <button className="btn-primary px-5 py-2.5 text-sm font-medium">Save changes</button>
            </form>
          ) : (
            <div className="text-sm space-y-1.5 text-ink/80">
              <p>Phone: {c.phone || "—"}</p><p>Email: {c.email || "—"}</p><p>City: {c.city || "—"}</p><p>Address: {c.address || "—"}</p>
            </div>
          )}
          {canManage && (
            <form action={deleteCustomerAction} className="mt-3 pt-3 border-t border-sand/60">
              <input type="hidden" name="id" value={c.id} />
              <button className="text-xs text-rose hover:underline">Delete customer</button>
            </form>
          )}
        </div>

        {/* Order history */}
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <h2 className="font-medium text-ink mb-3">Order history</h2>
          {orders.length === 0 ? <p className="text-sm text-muted">No orders yet for this customer.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-muted text-left"><tr><th className="py-1">Order</th><th className="py-1">Date</th><th className="py-1">Type</th><th className="py-1 text-right">Amount</th></tr></thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} className="border-t border-sand/50">
                    <td className="py-1.5"><Link href={`/admin/invoice/${o.id}`} className="text-emerald nav-link">{String(o.id).slice(0, 8).toUpperCase()} ↗</Link></td>
                    <td className="py-1.5 text-muted">{new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                    <td className="py-1.5 text-xs uppercase text-muted">{o.bill_type === "cash" ? "Cash" : "GST"} · {o.channel}</td>
                    <td className="py-1.5 text-right font-medium">{formatPaise(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </div>
      </div>
    </main>
  );
}
