export const dynamic = "force-dynamic";
/**
 * Returns — SALES and PURCHASE returns in ONE register (client request), each row showing the
 * bill it was made against, the party, every returned piece WITH its variant colour, and the
 * money value (credit note to customer / debit note to supplier).
 */
import Link from "next/link";
import { getRecentOrders, getRecentPurchases, getReturnsDetailed } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { ReturnClient } from "@/components/admin/ReturnClient";
import { PurchaseReturnClient } from "@/components/admin/PurchaseReturnClient";
import { OpenReturnClient } from "@/components/admin/OpenReturnClient";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Owner Console · Returns" };

export default async function Returns() {
  const [orders, purchases, returns] = await Promise.all([getRecentOrders(12), getRecentPurchases(), getReturnsDetailed(40)]);
  // Payment methods, so a refund that genuinely leaves the drawer can be posted to the right account.
  const { data: pmRows } = await supabaseServer().from("payment_methods").select("id,name").eq("active", true);
  const methods = ((pmRows as any[]) ?? []).map((m) => ({ id: m.id as string, name: (m.name as string) ?? "Account" }));
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Returns — Sales &amp; Purchases</h1>
      <p className="text-sm text-muted mb-2">Sales returns credit the customer and restock the exact colour; purchase returns send goods back to the supplier as a debit note. Every movement is capped per bill — the same pieces can never be returned twice.</p>
      <p className="text-xs text-gold-dark bg-gold/10 rounded-lg px-3 py-2 mb-4 inline-block">Staff-created sales returns go to Approvals for the owner&apos;s OTP. Purchase returns can be recorded right below, or from any purchase bill (<b>↩ Return to supplier</b>). Sales returns can also start from any bill row on <Link href="/admin/sales" className="underline">Sales Records</Link>.</p>
      <OpenReturnClient methods={methods} />
      <ReturnClient orders={orders as any} />
      <PurchaseReturnClient purchases={purchases as any} />

      <h2 className="font-medium text-ink mb-3">Recent returns · sales &amp; purchase</h2>
      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Type</th><th className="p-3">Against bill</th><th className="p-3">Party</th>
            <th className="p-3">Items · variant</th><th className="p-3 text-right">Qty</th>
            <th className="p-3 text-right">Value</th><th className="p-3">Reason</th><th className="p-3">When</th>
          </tr></thead>
          <tbody>
            {returns.length === 0 && <tr><td colSpan={8} className="p-4 text-muted">No returns recorded.</td></tr>}
            {returns.map((r) => (
              <tr key={r.id} className="border-t border-sand/60 align-top">
                <td className="p-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${r.kind === "sales" ? "bg-gold/15 text-gold-dark" : "bg-blue-100 text-blue-700"}`}>
                    {r.kind === "sales" ? "↩ Sales" : "⇤ Purchase"}
                  </span>
                </td>
                <td className="p-3 whitespace-nowrap">
                  {r.billHref ? <Link href={r.billHref} className="text-emerald nav-link font-medium">{r.billRef} ↗</Link> : <span className="text-muted">{r.billRef}</span>}
                </td>
                <td className="p-3 text-ink">{r.party}</td>
                <td className="p-3 text-ink">
                  {r.lines.length
                    ? r.lines.map((l, i) => (
                        <span key={i} className="inline-block mr-2 whitespace-nowrap">
                          <span className="font-mono text-xs">{l.sku ?? "—"}</span>
                          {l.color && <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] bg-cream border border-sand text-ink">{l.color}</span>}
                          <span className="text-muted"> ×{l.qty}</span>
                        </span>
                      ))
                    : <span className="text-muted text-xs">—</span>}
                </td>
                <td className="p-3 text-right tabular-nums">{r.qty}</td>
                <td className="p-3 text-right tabular-nums font-medium">
                  {r.amount > 0 ? <span className={r.kind === "sales" ? "text-rose" : "text-emerald-dark"}>{formatPaise(r.amount)}</span> : <span className="text-muted">—</span>}
                  {r.amount > 0 && <span className="block text-[10px] text-muted font-normal">{r.kind === "sales" ? "credit note" : "debit note"}</span>}
                </td>
                <td className="p-3 text-muted max-w-[180px] truncate">{r.reason ?? ""}</td>
                <td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
