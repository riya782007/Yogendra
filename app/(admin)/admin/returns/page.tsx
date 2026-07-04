export const dynamic = "force-dynamic";
import { getRecentOrders, getReturns } from "@/lib/supabase/queries";
import { ReturnClient } from "@/components/admin/ReturnClient";

export const metadata = { title: "Owner Console · Returns" };

export default async function Returns() {
  const [orders, returns] = await Promise.all([getRecentOrders(12), getReturns()]);
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Sales Returns</h1>
      <p className="text-sm text-muted mb-2">Capture a reason, restore stock, and keep an audit trail — books stay accurate.</p>
      <p className="text-xs text-gold-dark bg-gold/10 rounded-lg px-3 py-2 mb-6 inline-block">Staff-created returns require owner approval — they're sent to the Approvals page and processed once the owner clears them with the OTP.</p>
      <ReturnClient orders={orders as any} />

      <h2 className="font-medium text-ink mb-3">Recent returns</h2>
      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr><th className="p-3">Ref</th><th className="p-3">Qty</th><th className="p-3">Reason</th><th className="p-3">When</th></tr></thead>
          <tbody>
            {returns.length === 0 && <tr><td colSpan={4} className="p-4 text-muted">No returns recorded.</td></tr>}
            {returns.map((r: any) => (
              <tr key={r.id} className="border-t border-sand/60">
                <td className="p-3 text-muted">{String(r.id).slice(0, 8).toUpperCase()}</td>
                <td className="p-3">{r.qty} pcs</td>
                <td className="p-3 text-ink">{r.reason}</td>
                <td className="p-3 text-muted">{new Date(r.created_at).toLocaleDateString("en-IN")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
