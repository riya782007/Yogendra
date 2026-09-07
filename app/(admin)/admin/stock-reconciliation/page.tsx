export const dynamic = "force-dynamic";
import { StockReconciliationForm } from "@/components/admin/StockReconciliationForm";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

const rupees = (paise: number) => `${paise < 0 ? "−" : "+"}₹${Math.abs(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default async function StockReconciliationPage() {
  const allowed = await requirePerm("inventory.view");
  if (!allowed) return <main className="p-8 text-sm text-muted">You do not have permission to view inventory.</main>;
  const sb = supabaseServer();
  const { data } = await (sb.from("stock_reconciliations") as any)
    .select("id,sku,system_qty,physical_qty,delta,reason,note,unit_cost,inventory_value_impact,created_by,created_at, product:products(name), variant:variants(color)")
    .order("created_at", { ascending: false }).limit(100);
  const rows = (data ?? []) as any[];
  const netImpact = rows.reduce((sum, row) => sum + (Number(row.inventory_value_impact) || 0), 0);
  const losses = rows.filter((r) => r.inventory_value_impact < 0).reduce((sum, r) => sum + Math.abs(Number(r.inventory_value_impact) || 0), 0);
  return <main className="min-h-screen bg-cream/40 p-4 sm:p-8">
    <h1 className="font-display text-4xl text-ink">Stock Reconciliation</h1>
    <p className="mb-5 text-sm text-muted">Compare physical stock against the system. Every mismatch is permanently recorded with its cost impact; sales profit is unchanged.</p>
    <StockReconciliationForm />
    <div className="my-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-sand bg-white p-3"><p className="text-xs text-muted">Recorded counts</p><p className="text-xl font-semibold text-ink">{rows.length}</p></div>
      <div className="rounded-xl border border-sand bg-white p-3"><p className="text-xs text-muted">Inventory losses</p><p className="text-xl font-semibold text-rose">₹{(losses / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p></div>
      <div className="rounded-xl border border-sand bg-white p-3"><p className="text-xs text-muted">Net inventory-value impact</p><p className={`text-xl font-semibold ${netImpact < 0 ? "text-rose" : "text-emerald-dark"}`}>{rupees(netImpact)}</p></div>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card"><table className="w-full text-sm"><thead className="bg-cream text-left text-muted"><tr><th className="p-3">Date</th><th className="p-3">Item</th><th className="p-3">System → physical</th><th className="p-3">Reason</th><th className="p-3">Value impact</th><th className="p-3">Recorded by</th><th className="p-3">Evidence</th></tr></thead><tbody>
      {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-muted">No physical counts recorded.</td></tr>}
      {rows.map((r) => <tr key={r.id} className="border-t border-sand/60"><td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td><td className="p-3"><b>{r.product?.name ?? r.sku}</b><span className="block text-xs text-muted">{r.sku}{r.variant?.color ? ` · ${r.variant.color}` : ""}</span></td><td className="p-3 tabular-nums">{r.system_qty} → {r.physical_qty} <b className={r.delta < 0 ? "text-rose" : "text-emerald-dark"}>({r.delta > 0 ? "+" : ""}{r.delta})</b></td><td className="p-3 capitalize">{String(r.reason).replace(/_/g, " ")}</td><td className={`p-3 font-medium ${r.inventory_value_impact < 0 ? "text-rose" : "text-emerald-dark"}`}>{rupees(r.inventory_value_impact)}</td><td className="p-3">{r.created_by}</td><td className="p-3 text-muted">{r.note || "—"}</td></tr>)}
    </tbody></table></div>
  </main>;
}
