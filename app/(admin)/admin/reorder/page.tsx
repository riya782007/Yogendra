export const dynamic = "force-dynamic";
import { getReorderCandidates } from "@/lib/supabase/queries";
import { ReorderClient } from "@/components/admin/ReorderClient";

export const metadata = { title: "Owner Console · AI Reorder" };

export default async function Reorder() {
  const cands = await getReorderCandidates();
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">AI Reorder Planner</h1>
      <p className="text-sm text-muted mb-6">Let the inventory agent draft what to restock and what to clear — then approve, and the right person is notified automatically.</p>
      <ReorderClient candidateCount={cands.length} />
      <div className="mt-8 bg-white rounded-2xl p-5 shadow-card">
        <h2 className="font-medium text-ink mb-3">Items the agent is watching</h2>
        <table className="w-full text-sm">
          <thead className="text-muted text-left"><tr><th className="py-1">Product</th><th className="py-1">Qty</th><th className="py-1">Last sold</th><th className="py-1">Status</th></tr></thead>
          <tbody>
            {cands.map((c) => (
              <tr key={c.sku} className="border-t border-sand/50">
                <td className="py-2 text-ink">{c.name} <span className="text-muted text-xs">· {c.sku}</span></td>
                <td className="py-2">{c.qty}</td>
                <td className="py-2 text-muted">{c.daysSince == null ? "never" : `${c.daysSince}d ago`}</td>
                <td className="py-2"><span className={`text-xs px-2 py-0.5 rounded-full capitalize ${c.cls === "dead" ? "bg-red-100 text-red-700" : c.cls === "low" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-700"}`}>{c.cls}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
