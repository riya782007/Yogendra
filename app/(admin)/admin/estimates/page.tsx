export const dynamic = "force-dynamic";
import Link from "next/link";
import { getEstimates, getStorefront } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { formatPaise } from "@/lib/pricing";
import { EstimateClient } from "@/components/admin/EstimateClient";
import { billEstimateAction, denyEstimateAction, reopenEstimateAction } from "@/app/actions/billing";

export const metadata = { title: "Owner Console · Estimates" };

const TABS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "open", label: "Held", match: (s) => s === "open" },
  { key: "converted", label: "GST billed", match: (s) => s === "converted" },
  { key: "cash_billed", label: "Cash billed", match: (s) => s === "cash_billed" },
  { key: "denied", label: "Denied", match: (s) => s === "denied" || s === "expired" },
];

const STATUS_STYLE: Record<string, string> = {
  open: "bg-gold/15 text-gold-dark",
  converted: "bg-emerald-mist text-emerald-dark",
  cash_billed: "bg-blue-100 text-blue-700",
  denied: "bg-rose/15 text-rose",
  expired: "bg-cream text-muted",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Held", converted: "GST billed", cash_billed: "Cash billed", denied: "Denied", expired: "Expired",
};

export default async function Estimates({ searchParams }: { searchParams: { tab?: string; q?: string; sort?: string } }) {
  const [{ products, formula }, estimates] = await Promise.all([getStorefront({ includeDrafts: true, includeWholesaleOnly: true }), getEstimates({ sort: searchParams.sort })]);
  const list = products.map((p) => ({ sku: p.sku, name: p.name, price: liveOffer(p.base_wholesale, formula).price }));

  const tab = TABS.find((t) => t.key === (searchParams.tab ?? "all")) ?? TABS[0];
  const q = (searchParams.q ?? "").toLowerCase().trim();
  const rows = estimates.filter((e: any) => tab.match(e.status) && (!q || (e.customer_name ?? "").toLowerCase().includes(q) || String(e.id).toLowerCase().includes(q)));
  const counts = Object.fromEntries(TABS.map((t) => [t.key, estimates.filter((e: any) => t.match(e.status)).length]));

  // Pillar 1 — sortable column headers, mirroring the sales register so A–Z by customer
  // and Ref-ID order are one click away on quotes too.
  const sort = searchParams.sort ?? "date_desc";
  const [sortField, sortDir] = sort.split("_");
  const sortHref = (field: string, firstAsc: boolean) => {
    const next = sortField === field
      ? (sortDir === "asc" ? `${field}_desc` : `${field}_asc`)
      : (firstAsc ? `${field}_asc` : `${field}_desc`);
    const sp = new URLSearchParams();
    sp.set("tab", tab.key);
    if (searchParams.q) sp.set("q", searchParams.q);
    sp.set("sort", next);
    return `/admin/estimates?${sp.toString()}`;
  };
  const arrow = (field: string) => sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Estimates &amp; Quotations</h1>
      <p className="text-sm text-muted mb-6">Quote now; bill only when the customer confirms. Each estimate can be held, billed with GST, billed as a cash memo, or denied.</p>
      <EstimateClient products={list} />

      {/* tabs + search */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {TABS.map((t) => {
          const sp = new URLSearchParams(); sp.set("tab", t.key);
          if (searchParams.sort) sp.set("sort", searchParams.sort);
          return (
            <Link key={t.key} href={`/admin/estimates?${sp.toString()}`}
              className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${tab.key === t.key ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`}>
              {t.label} <span className="opacity-60">{counts[t.key] ?? 0}</span>
            </Link>
          );
        })}
        <form className="ml-auto" action="/admin/estimates">
          <input type="hidden" name="tab" value={tab.key} />
          {searchParams.sort && <input type="hidden" name="sort" value={searchParams.sort} />}
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search customer / ref…" className="rounded-full border border-sand px-4 py-1.5 text-sm bg-white outline-none focus:border-emerald w-56" />
        </form>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3"><Link href={sortHref("ref", true)} className="hover:text-ink">Ref <span className="opacity-60">{arrow("ref")}</span></Link></th>
            <th className="p-3"><Link href={sortHref("customer", true)} className="hover:text-ink">Customer <span className="opacity-60">{arrow("customer")}</span></Link></th>
            <th className="p-3"><Link href={sortHref("amount", false)} className="hover:text-ink">Total <span className="opacity-60">{arrow("amount")}</span></Link></th>
            <th className="p-3">Status</th>
            <th className="p-3"><Link href={sortHref("date", false)} className="hover:text-ink">Date <span className="opacity-60">{arrow("date")}</span></Link></th>
            <th className="p-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-muted">No estimates here.</td></tr>}
            {rows.map((e: any) => (
              <tr key={e.id} className="border-t border-sand/60 align-middle">
                <td className="p-3 text-muted whitespace-nowrap">{String(e.id).slice(0, 8).toUpperCase()}</td>
                <td className="p-3 text-ink">{e.customer_name || "—"}{e.customer_phone && <span className="block text-xs text-muted">{e.customer_phone}</span>}</td>
                <td className="p-3 font-medium whitespace-nowrap">{formatPaise(e.total)}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_STYLE[e.status] ?? "bg-cream text-muted"}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                <td className="p-3 text-muted whitespace-nowrap">{new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1.5 justify-end items-center">
                    <Link href={`/admin/estimate/${e.id}`} className="px-2.5 py-1 rounded-full bg-ink/5 text-ink text-xs hover:bg-ink/10">🖶 Print</Link>
                    {e.status === "open" && <>
                      <form action={billEstimateAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="bill_type" value="gst" /><button className="px-2.5 py-1 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20">Bill · GST →</button></form>
                      <form action={billEstimateAction}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="bill_type" value="cash" /><button className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100">Bill · Cash →</button></form>
                      <form action={denyEstimateAction}><input type="hidden" name="id" value={e.id} /><button className="px-2.5 py-1 rounded-full bg-rose/10 text-rose text-xs hover:bg-rose/20">Deny</button></form>
                    </>}
                    {(e.status === "converted" || e.status === "cash_billed") && e.order_id &&
                      <Link href={`/admin/invoice/${e.order_id}`} className="px-2.5 py-1 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20">{e.status === "cash_billed" ? "View cash memo →" : "View invoice →"}</Link>}
                    {(e.status === "denied" || e.status === "expired") &&
                      <form action={reopenEstimateAction}><input type="hidden" name="id" value={e.id} /><button className="px-2.5 py-1 rounded-full bg-gold/15 text-gold-dark text-xs hover:bg-gold/25">Re-open</button></form>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
