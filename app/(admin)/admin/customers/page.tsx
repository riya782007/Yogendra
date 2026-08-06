export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCustomersDb, getCustomers, getCustomerSpend } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { Pager } from "@/components/admin/Pager";
import { getSession, can } from "@/lib/auth";
import { upsertCustomerAction } from "@/app/actions/customers";
import { ReceivePaymentButton } from "@/components/admin/ReceivePaymentButton";

export const metadata = { title: "Owner Console · Customers" };
const PAGE_SIZE = 20;
const TYPE_STYLE: Record<string, string> = { wholesale: "bg-gold/15 text-gold-dark", retail: "bg-emerald-mist text-emerald-dark" };
const CLOSE = 0.7; // "close to target" = has spent at least 70% of the target

function rangeFor(period: string): { from?: string; label: string } {
  const now = new Date();
  if (period === "all") return { label: "all time" };
  if (period === "30d") return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), label: "last 30 days" };
  if (period === "quarter") return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString(), label: "last 3 months" };
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), label: "this month" };
}
const waLink = (phone: string, msg: string) => {
  const d = (phone || "").replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `https://wa.me/91${d}?text=${encodeURIComponent(msg)}` : "";
};

export default async function Customers({ searchParams }: { searchParams: { q?: string; type?: string; page?: string; period?: string; target?: string; band?: string; delerror?: string } }) {
  const delError = searchParams.delerror?.trim();
  const q = searchParams.q ?? "";
  const type = searchParams.type ?? "all";
  const period = searchParams.period ?? "month";
  const band = searchParams.band ?? "all"; // all | reached | close
  const targetRupees = Math.max(0, parseInt(searchParams.target ?? "50000", 10) || 0);
  const targetPaise = targetRupees * 100;
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const range = rangeFor(period);

  const [allRaw, topSpenders, spendMap] = await Promise.all([
    getCustomersDb({ q, type }),
    getCustomers(),
    getCustomerSpend({ from: range.from }),
  ]);

  // Merge each customer's spend-in-period, then optionally filter by promotional band + sort by spend.
  let all = allRaw.map((c: any) => ({ ...c, spend: spendMap.get(c.id)?.spend ?? 0, ordersInPeriod: spendMap.get(c.id)?.orders ?? 0 }));
  const targeting = band !== "all" && targetPaise > 0;
  if (targeting) {
    all = all.filter((c) => band === "reached" ? c.spend >= targetPaise : c.spend >= targetPaise * CLOSE && c.spend < targetPaise);
  }
  if (targeting || period !== "all") all.sort((a, b) => b.spend - a.spend);

  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const canManage = can(getSession(), "customers.manage");
  const sel = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald w-full";

  const reachedCount = all.filter((c) => c.spend >= targetPaise).length;
  const closeCount = allRaw.map((c: any) => spendMap.get(c.id)?.spend ?? 0).filter((s) => s >= targetPaise * CLOSE && s < targetPaise).length;
  const bandTab = (key: string, label: string) =>
    `px-3 py-1.5 rounded-full text-xs ${band === key ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-emerald"}`;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Customers</h1>
      <p className="text-sm text-muted mb-5">Your customer directory — retail &amp; wholesale, with GST details and credit balance. Click a customer for full history.</p>
      {delError && <div className="mb-5 rounded-xl border border-rose/40 bg-rose/5 px-4 py-3 text-sm text-rose">Couldn&apos;t delete that customer — {delError}</div>}

      {/* Add */}
      {canManage && (
        <form key={allRaw.length} action={upsertCustomerAction} className="bg-white rounded-2xl p-5 shadow-card mb-5 border border-sand">
          <h2 className="font-medium text-ink mb-3">Add customer</h2>
          <div className="grid sm:grid-cols-3 gap-3">
            <input name="name" placeholder="Name / firm *" className={fld} required />
            <select name="type" defaultValue="retail" className={fld}><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select>
            <input name="phone" placeholder="Phone" className={fld} />
            <input name="gstin" placeholder="GSTIN (for B2B)" className={fld} />
            <input name="city" placeholder="City" className={fld} />
            <input name="credit_balance" type="number" placeholder="Outstanding due ₹" className={fld} />
            <input name="address" placeholder="Address" className={`${fld} sm:col-span-2`} />
            <input name="email" placeholder="Email" className={fld} />
          </div>
          <button className="btn-primary px-5 py-2.5 text-sm font-medium mt-3">Save customer</button>
        </form>
      )}

      {/* 🎯 Promotion targeting — find who hit a spend target, and who's close, for a promo push */}
      <form action="/admin/customers" className="bg-white rounded-2xl p-4 shadow-card mb-4 border border-gold/40">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="font-medium text-ink">🎯 Promotion targeting</p>
            <p className="text-[11px] text-muted">Find customers who reached a spend target (or are close) so you can reward or nudge them.</p>
          </div>
          <label className="text-[11px] text-muted ml-auto">Target ₹<input name="target" type="number" min={0} step={1000} defaultValue={targetRupees} className={`${sel} block mt-0.5 w-32`} /></label>
          <label className="text-[11px] text-muted">Period
            <select name="period" defaultValue={period} className={`${sel} block mt-0.5`}>
              <option value="month">This month</option>
              <option value="30d">Last 30 days</option>
              <option value="quarter">Last 3 months</option>
              <option value="all">All time</option>
            </select>
          </label>
          {/* preserve search/type */}
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="type" value={type} />
          <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Apply</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="text-[11px] uppercase tracking-wide text-muted mr-1">Show</span>
          <Link href={`/admin/customers?${new URLSearchParams({ q, type, period, target: String(targetRupees), band: "all" })}`} className={bandTab("all", "All")}>All customers</Link>
          <Link href={`/admin/customers?${new URLSearchParams({ q, type, period, target: String(targetRupees), band: "reached" })}`} className={bandTab("reached", "Reached")}>✓ Reached target ({reachedCount})</Link>
          <Link href={`/admin/customers?${new URLSearchParams({ q, type, period, target: String(targetRupees), band: "close" })}`} className={bandTab("close", "Close")}>◗ Close ≥{Math.round(CLOSE * 100)}% ({closeCount})</Link>
          <span className="ml-auto text-[11px] text-muted">Target {formatPaise(targetPaise)} · {range.label}</span>
        </div>
      </form>

      {/* Search filters */}
      <form action="/admin/customers" className="flex flex-wrap gap-2 mb-4">
        <input name="q" defaultValue={q} placeholder="Search name / phone / GSTIN…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[160px]" />
        <select name="type" defaultValue={type} className={sel}><option value="all">All types</option><option value="retail">Retail</option><option value="wholesale">Wholesale</option></select>
        <input type="hidden" name="period" value={period} />
        <input type="hidden" name="target" value={targetRupees} />
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Filter</button>
        {(q || type !== "all" || band !== "all") && <Link href="/admin/customers" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">Phone</th>
            <th className="p-3 text-right">Spent ({range.label})</th><th className="p-3">Target progress</th><th className="p-3 text-right">Outstanding</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-muted">No customers match. {band !== "all" ? "Try a lower target or a wider period." : "Add one above, or they'll appear as you bill them."}</td></tr>}
            {rows.map((c: any) => {
              const pct = targetPaise > 0 ? Math.min(100, Math.round((c.spend / targetPaise) * 100)) : 0;
              const reached = c.spend >= targetPaise && targetPaise > 0;
              const remaining = Math.max(0, targetPaise - c.spend);
              const wa = waLink(c.phone, reached
                ? `Hi ${c.name}, thank you for shopping with Blythe Diva! You've reached our offer target — your reward is ready. 🎁`
                : `Hi ${c.name}, you're almost at our Blythe Diva offer! Spend ${formatPaise(remaining)} more this period to unlock it. ✨`);
              return (
                <tr key={c.id} className="border-t border-sand/60 hover:bg-cream/40">
                  <td className="p-3"><Link href={`/admin/customer/${c.id}`} className="text-emerald nav-link font-medium">{c.name}</Link>{c.city ? <span className="block text-[11px] text-muted">{c.city}</span> : null}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${TYPE_STYLE[c.type] ?? "bg-cream text-muted"}`}>{c.type}</span></td>
                  <td className="p-3 text-muted">{c.phone || "—"}</td>
                  <td className="p-3 text-right tabular-nums">{c.spend ? <span className="font-medium text-ink">{formatPaise(c.spend)}</span> : <span className="text-muted">—</span>}</td>
                  <td className="p-3">
                    {targetPaise > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-sand/70 overflow-hidden"><div className={`h-full ${reached ? "bg-emerald" : "bg-gold"}`} style={{ width: `${pct}%` }} /></div>
                        <span className={`text-[11px] tabular-nums ${reached ? "text-emerald-dark" : "text-muted"}`}>{reached ? "✓" : `${pct}%`}</span>
                      </div>
                    ) : <span className="text-muted text-xs">—</span>}
                  </td>
                  <td className="p-3 text-right">{c.credit_balance ? <span className="text-rose font-medium">{formatPaise(c.credit_balance)}</span> : <span className="text-muted">—</span>}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <ReceivePaymentButton customerId={c.id} phone={c.phone || null} customerName={c.name} />
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-[11px] text-emerald hover:underline whitespace-nowrap">Reach out ↗</a>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager basePath="/admin/customers" params={{ q, type, period, target: String(targetRupees), band }} page={page} pageSize={PAGE_SIZE} total={all.length} />

      {/* Top spenders (all-time analytics, derived from orders) */}
      <div className="bg-white rounded-2xl p-6 shadow-card mt-6">
        <h2 className="font-medium text-ink mb-3">Top customers by spend (all time)</h2>
        <table className="w-full text-sm">
          <thead className="text-muted text-left"><tr><th className="py-1">Name</th><th className="py-1">Phone</th><th className="py-1 text-right">Orders</th><th className="py-1 text-right">Spent</th></tr></thead>
          <tbody>
            {topSpenders.length === 0 && <tr><td colSpan={4} className="py-3 text-muted">No sales yet.</td></tr>}
            {topSpenders.slice(0, 10).map((c: any) => (
              <tr key={c.name} className="border-t border-sand/50">
                <td className="py-2 text-ink">{c.name}</td><td className="py-2 text-muted">{c.phone ?? "—"}</td>
                <td className="py-2 text-right">{c.orders}</td><td className="py-2 text-right font-medium text-emerald">{formatPaise(c.spent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
