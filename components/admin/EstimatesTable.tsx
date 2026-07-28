"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/pricing";
import { billEstimateAction, denyEstimateAction, reopenEstimateAction } from "@/app/actions/billing";

type E = { id: string; customer_name: string | null; customer_phone: string | null; total: number; status: string; created_at: string; order_id: string | null };

// Default view = "To bill" (only estimates still needing action). Everything already billed (GST or cash)
// sits in ONE "Handled" tab; denied/expired in their own. All filtering/sorting is CLIENT-side so
// switching tabs is instant — no server round-trip (the old links reloaded ~25k rows each click).
const TABS: { key: string; label: string; match: (s: string) => boolean }[] = [
  { key: "open", label: "To bill", match: (s) => s === "open" },
  { key: "handled", label: "Handled (billed)", match: (s) => s === "converted" || s === "cash_billed" },
  { key: "denied", label: "Denied", match: (s) => s === "denied" || s === "expired" },
  { key: "all", label: "All", match: () => true },
];
const STATUS_STYLE: Record<string, string> = {
  open: "bg-gold/15 text-gold-dark", converted: "bg-emerald-mist text-emerald-dark",
  cash_billed: "bg-blue-100 text-blue-700", denied: "bg-rose/15 text-rose", expired: "bg-cream text-muted",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Held", converted: "GST billed", cash_billed: "Cash billed", denied: "Denied", expired: "Expired",
};

export function EstimatesTable({ estimates }: { estimates: E[] }) {
  const [tabKey, setTabKey] = useState("open");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("date_desc");
  const tab = TABS.find((t) => t.key === tabKey) ?? TABS[0];
  const [sortField, sortDir] = sort.split("_");

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t.key, estimates.filter((e) => t.match(e.status)).length])), [estimates]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase().trim();
    const filtered = estimates.filter((e) => tab.match(e.status) && (!ql || (e.customer_name ?? "").toLowerCase().includes(ql) || String(e.id).toLowerCase().includes(ql)));
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let c = 0;
      if (sortField === "ref") c = String(a.id).localeCompare(String(b.id));
      else if (sortField === "customer") c = (a.customer_name ?? "").localeCompare(b.customer_name ?? "");
      else if (sortField === "amount") c = (a.total ?? 0) - (b.total ?? 0);
      else c = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return c * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimates, tabKey, q, sort]);

  const toggleSort = (field: string, firstAsc: boolean) => setSort((prev) => {
    const [f, dr] = prev.split("_");
    if (f === field) return `${field}_${dr === "asc" ? "desc" : "asc"}`;
    return `${field}_${firstAsc ? "asc" : "desc"}`;
  });
  const arrow = (field: string) => (sortField === field ? (sortDir === "asc" ? "↑" : "↓") : "↕");
  const Th = ({ field, firstAsc, children }: { field: string; firstAsc: boolean; children: React.ReactNode }) => (
    <th className="p-3"><button onClick={() => toggleSort(field, firstAsc)} className="hover:text-ink">{children} <span className="opacity-60">{arrow(field)}</span></button></th>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTabKey(t.key)}
            className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${tab.key === t.key ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`}>
            {t.label} <span className="opacity-60">{counts[t.key] ?? 0}</span>
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer / ref…"
          className="ml-auto rounded-full border border-sand px-4 py-1.5 text-sm bg-white outline-none focus:border-emerald w-56" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <Th field="ref" firstAsc>Ref</Th>
            <Th field="customer" firstAsc>Customer</Th>
            <Th field="amount" firstAsc={false}>Total</Th>
            <th className="p-3">Status</th>
            <Th field="date" firstAsc={false}>Date</Th>
            <th className="p-3 text-right">Actions</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-muted">No estimates here.</td></tr>}
            {rows.map((e) => (
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
    </>
  );
}
