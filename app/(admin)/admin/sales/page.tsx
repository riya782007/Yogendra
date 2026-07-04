export const dynamic = "force-dynamic";
import Link from "next/link";
import { getOrdersPage } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { Pager } from "@/components/admin/Pager";
import { getSession, can } from "@/lib/auth";

export const metadata = { title: "Owner Console · Sales Records" };
const PAGE_SIZE = 25;

const CHANNELS = [
  { key: "all", label: "All channels" },
  { key: "retail", label: "Online retail" },
  { key: "wholesale", label: "Wholesale" },
  { key: "pos", label: "Counter (POS)" },
];
const CH_STYLE: Record<string, string> = {
  retail: "bg-emerald-mist text-emerald-dark", wholesale: "bg-gold/15 text-gold-dark", pos: "bg-blue-100 text-blue-700",
};

export default async function SalesRecords({ searchParams }: { searchParams: { page?: string; q?: string; channel?: string; from?: string; to?: string; sort?: string } }) {
  const page = parseInt(searchParams.page ?? "1", 10) || 1;
  const q = searchParams.q ?? "";
  const channel = searchParams.channel ?? "all";
  const from = searchParams.from ?? "";
  const to = searchParams.to ?? "";
  const sort = searchParams.sort ?? "";
  const session = getSession();
  // `billing.gst_only` is a RESTRICTION for the GST-Officer role — it must never apply to the owner
  // (whose "*" wildcard would otherwise match it and hide their own cash memos & estimates).
  const gstOnly = !session.isOwner && session.permissions !== "*" && can(session, "billing.gst_only");
  const { rows, total } = await getOrdersPage({ page, pageSize: PAGE_SIZE, q, channel, from: from || undefined, to: to ? to + "T23:59:59" : undefined, sort, billType: gstOnly ? "gst" : undefined });
  // Show sales WITH and WITHOUT tax together. `total` is the taxable value (pre-GST); a GST bill's
  // grand total adds 3% GST rounded to the nearest ₹1 (matches the invoice); a cash memo has no tax.
  const withoutTax = (r: any) => r.total ?? 0;
  const withTax = (r: any) => (r.bill_type === "cash" ? (r.total ?? 0) : Math.round(((r.total ?? 0) + Math.round((r.total ?? 0) * 0.03)) / 100) * 100);
  const pageSumNoTax = rows.reduce((s: number, r: any) => s + withoutTax(r), 0);
  const pageSumWithTax = rows.reduce((s: number, r: any) => s + withTax(r), 0);
  const sel = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  // Pillar 1 — sortable register: click a header to sort A–Z / Z–A (toggles on repeat click).
  const sortHref = (field: string, firstAsc: boolean) => {
    const asc = `${field}_asc`, desc = `${field}_desc`;
    const first = firstAsc ? asc : desc;
    const next = sort === first ? (firstAsc ? desc : asc) : first;
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (channel !== "all") p.set("channel", channel);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("sort", next);
    return `/admin/sales?${p.toString()}`;
  };
  const arrow = (field: string) => (sort === `${field}_asc` ? " ↑" : sort === `${field}_desc` ? " ↓" : " ↕");
  const thLink = "inline-flex items-center gap-0.5 hover:text-ink";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Sales Records</h1>
      <p className="text-sm text-muted mb-5">Every sale across all channels. Click an order to open its bill &amp; full detail.</p>
      {gstOnly && <div className="mb-5 rounded-xl border border-emerald/30 bg-emerald-mist/40 px-4 py-2 text-sm text-emerald-dark">Compliance view — showing <b>GST tax invoices only</b>. Cash memos and estimates are hidden for this role.</div>}

      <form action="/admin/sales" className="flex flex-wrap gap-2 mb-4 items-center">
        <input name="q" defaultValue={q} placeholder="Search customer / phone…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[160px]" />
        <select name="channel" defaultValue={channel} className={sel}>{CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
        <label className="text-xs text-muted flex items-center gap-1">From <input type="date" name="from" defaultValue={from} className={sel} /></label>
        <label className="text-xs text-muted flex items-center gap-1">To <input type="date" name="to" defaultValue={to} className={sel} /></label>
        <input type="hidden" name="sort" value={sort} />
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Filter</button>
        {(q || channel !== "all" || from || to || sort) && <Link href="/admin/sales" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3"><Link href={sortHref("inv", true)} className={thLink}>Invoice / Order{arrow("inv")}</Link></th>
            <th className="p-3"><Link href={sortHref("date", false)} className={thLink}>Date{arrow("date")}</Link></th>
            <th className="p-3"><Link href={sortHref("name", true)} className={thLink}>Customer{arrow("name")}</Link></th>
            <th className="p-3">Channel</th><th className="p-3">Bill</th><th className="p-3">Status</th>
            <th className="p-3 text-right">Without tax</th>
            <th className="p-3 text-right"><Link href={sortHref("amount", false)} className={thLink}>With tax{arrow("amount")}</Link></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={8} className="p-4 text-muted">No sales match these filters.</td></tr>}
            {rows.map((r: any) => (
              <tr key={r.id} className="border-t border-sand/60 hover:bg-cream/40">
                <td className="p-3"><Link href={`/admin/invoice/${r.id}`} className="text-emerald nav-link font-medium">{r.invoice_no || String(r.id).slice(0, 8).toUpperCase()} ↗</Link>{r.source_tag === "estimate"
                  ? <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gold/15 text-gold-dark">from estimate</span>
                  : r.source_tag && <span className="block text-[10px] text-muted">via {r.source_tag}</span>}</td>
                <td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                <td className="p-3 text-ink">{r.customer_name || "Walk-in"}{r.customer_phone && <span className="block text-xs text-muted">{r.customer_phone}</span>}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${CH_STYLE[r.channel] ?? "bg-cream text-muted"}`}>{r.channel}</span></td>
                <td className="p-3 text-xs uppercase text-muted">{r.bill_type === "cash" ? "Cash memo" : "GST"}</td>
                <td className="p-3">{(() => { const paid = r.amount_paid ?? 0; const st = paid <= 0 ? "Unpaid" : paid >= r.total ? "Paid" : "Partial"; const cls: Record<string, string> = { Paid: "bg-emerald-mist text-emerald-dark", Partial: "bg-gold/15 text-gold-dark", Unpaid: "bg-rose/10 text-rose" }; return <span className={`px-2 py-0.5 rounded-full text-xs ${cls[st]}`}>{st}</span>; })()}</td>
                <td className="p-3 text-right text-muted tabular-nums"><span className="sensitive">{formatPaise(withoutTax(r))}</span></td>
                <td className="p-3 text-right font-medium tabular-nums"><span className="sensitive">{formatPaise(withTax(r))}</span>{r.bill_type !== "cash" && withTax(r) !== withoutTax(r) && <span className="block text-[10px] text-muted font-normal">incl. GST</span>}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && <tfoot><tr className="border-t border-sand bg-cream/40"><td colSpan={6} className="p-3 text-right text-muted">This page</td><td className="p-3 text-right font-semibold text-muted tabular-nums"><span className="sensitive">{formatPaise(pageSumNoTax)}</span></td><td className="p-3 text-right font-semibold text-ink tabular-nums"><span className="sensitive">{formatPaise(pageSumWithTax)}</span></td></tr></tfoot>}
        </table>
      </div>
      <Pager basePath="/admin/sales" params={{ q, channel, from, to, sort }} page={page} pageSize={PAGE_SIZE} total={total} />
    </main>
  );
}
