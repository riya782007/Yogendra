export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { createVoucherAction, toggleVoucherAction, deleteVoucherAction } from "@/app/actions/vouchers";

export const metadata = { title: "Owner Console · Vouchers" };

export default async function VouchersPage() {
  const sb = supabaseServer();
  const { data } = await sb.from("vouchers").select("*").order("created_at", { ascending: false });
  const vouchers = (data as any[]) ?? [];
  const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Vouchers &amp; Coupons</h1>
      <p className="text-sm text-muted mb-6">Create discount codes for the storefront &amp; wholesale panel. Customers enter the code at checkout — the discount is applied and re-checked on the server.</p>

      {/* Create */}
      <form action={createVoucherAction} className="bg-white rounded-2xl p-5 shadow-card border border-sand mb-6">
        <h2 className="font-display text-xl text-ink mb-3">New coupon</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="text-xs text-muted">Code <input name="code" required placeholder="DIWALI10" className={`${inp} w-full mt-0.5 uppercase tracking-widest`} /></label>
          <label className="text-xs text-muted">Type
            <select name="kind" className={`${inp} w-full mt-0.5`}>
              <option value="percent">% off</option>
              <option value="flat">Flat ₹ off</option>
            </select>
          </label>
          <label className="text-xs text-muted">Value <span className="text-muted/60">(% or ₹)</span><input name="value" type="number" min={1} required placeholder="10" className={`${inp} w-full mt-0.5`} /></label>
          <label className="text-xs text-muted">Min order ₹ <input name="min_order" type="number" min={0} placeholder="0" className={`${inp} w-full mt-0.5`} /></label>
          <label className="text-xs text-muted">Max discount ₹ <span className="text-muted/60">(% cap)</span><input name="max_discount" type="number" min={0} placeholder="optional" className={`${inp} w-full mt-0.5`} /></label>
          <label className="text-xs text-muted">Channel
            <select name="channel" className={`${inp} w-full mt-0.5`}>
              <option value="all">All</option>
              <option value="retail">Retail only</option>
              <option value="wholesale">Wholesale only</option>
            </select>
          </label>
          <label className="text-xs text-muted">Usage limit <span className="text-muted/60">(blank = ∞)</span><input name="usage_limit" type="number" min={0} placeholder="unlimited" className={`${inp} w-full mt-0.5`} /></label>
          <label className="text-xs text-muted">Expires on <input name="ends_at" type="date" className={`${inp} w-full mt-0.5`} /></label>
          <div className="flex items-end"><button className="btn-primary px-6 py-2 text-sm font-medium">Create coupon</button></div>
        </div>
      </form>

      {/* List */}
      <div className="bg-white rounded-2xl shadow-card border border-sand overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Code</th><th className="p-3">Discount</th><th className="p-3">Min order</th><th className="p-3">Channel</th><th className="p-3">Used</th><th className="p-3">Expires</th><th className="p-3">Status</th><th className="p-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {vouchers.length === 0 && <tr><td colSpan={8} className="p-6 text-center text-muted">No coupons yet — create your first above.</td></tr>}
            {vouchers.map((v) => (
              <tr key={v.id} className="border-t border-sand/60">
                <td className="p-3 font-mono font-medium text-ink">{v.code}</td>
                <td className="p-3">{v.kind === "percent" ? `${v.value}% off${v.max_discount ? ` (max ${formatPaise(v.max_discount)})` : ""}` : `${formatPaise(v.value)} off`}</td>
                <td className="p-3">{v.min_order > 0 ? formatPaise(v.min_order) : "—"}</td>
                <td className="p-3 capitalize">{v.channel}</td>
                <td className="p-3">{v.used_count ?? 0}{v.usage_limit ? ` / ${v.usage_limit}` : ""}</td>
                <td className="p-3">{day(v.ends_at)}</td>
                <td className="p-3">{v.active ? <span className="text-emerald-dark">● Active</span> : <span className="text-muted">○ Off</span>}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <form action={toggleVoucherAction} className="inline">
                    <input type="hidden" name="id" value={v.id} /><input type="hidden" name="active" value={v.active ? "0" : "1"} />
                    <button className="text-xs text-emerald nav-link mr-3">{v.active ? "Turn off" : "Turn on"}</button>
                  </form>
                  <form action={deleteVoucherAction} className="inline">
                    <input type="hidden" name="id" value={v.id} />
                    <button className="text-xs text-rose nav-link">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
