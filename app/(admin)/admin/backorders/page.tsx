export const dynamic = "force-dynamic";
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { fulfillBackorderAction } from "@/app/actions/billing";

export const metadata = { title: "Owner Console · Backorders" };

const CH_STYLE: Record<string, string> = {
  retail: "bg-emerald-mist text-emerald-dark",
  wholesale: "bg-gold/15 text-gold-dark",
  pos: "bg-blue-100 text-blue-700",
};

export default async function Backorders() {
  const sb = supabaseServer();
  const { data, error } = await sb
    .from("orders")
    .select("id,total,amount_paid,invoice_no,channel,bill_type,customer_name,customer_phone,created_at,is_backorder")
    .eq("is_backorder", true)
    .order("created_at", { ascending: false })
    .limit(200);

  // Until migration 0020 adds the column, the query errors on the unknown column.
  // Show a clear, friendly setup note instead of crashing the page.
  const migrationMissing = !!error && /is_backorder|column|does not exist/i.test(error.message ?? "");
  const rows = (data as any[]) ?? [];
  const pending = rows.reduce((s, r) => s + Math.max(0, (r.total ?? 0) - (r.amount_paid ?? 0)), 0);

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Backorders</h1>
      <p className="text-sm text-muted mb-5">
        Sales billed beyond available stock (you ticked &ldquo;bill anyway as a backorder&rdquo; at the counter).
        Fulfil these as fresh stock comes in. Open any row to see its bill &amp; items.
      </p>

      {migrationMissing ? (
        <div className="rounded-2xl border border-gold/40 bg-gold/10 p-5 text-sm text-ink">
          <p className="font-medium mb-1">One-time setup needed</p>
          <p className="text-muted">
            Run <code className="bg-white px-1 rounded border border-sand">supabase/migrations/0020_order_backorder.sql</code> on
            your Supabase project (SQL editor), then reload this page. New backordered sales will appear here automatically.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
              <p className="text-xs text-muted">Open backorders</p>
              <p className="text-2xl font-semibold text-ink">{rows.length}</p>
            </div>
            <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
              <p className="text-xs text-muted">Balance pending on them</p>
              <p className="text-2xl font-semibold text-ink">{formatPaise(pending)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-cream text-muted text-left">
                <tr>
                  <th className="p-3">Invoice / Order</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Channel</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3 text-right">Fulfil</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="p-4 text-muted">No backorders — every sale so far was within stock. 🎉</td></tr>
                )}
                {rows.map((r) => {
                  const paid = r.amount_paid ?? 0;
                  const st = paid <= 0 ? "Unpaid" : paid >= r.total ? "Paid" : "Partial";
                  const cls: Record<string, string> = { Paid: "bg-emerald-mist text-emerald-dark", Partial: "bg-gold/15 text-gold-dark", Unpaid: "bg-rose/10 text-rose" };
                  return (
                    <tr key={r.id} className="border-t border-sand/60 hover:bg-cream/40">
                      <td className="p-3">
                        <Link href={`/admin/invoice/${r.id}`} className="text-emerald nav-link font-medium">
                          {r.invoice_no || String(r.id).slice(0, 8).toUpperCase()} ↗
                        </Link>
                      </td>
                      <td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                      <td className="p-3 text-ink">{r.customer_name || "Walk-in"}{r.customer_phone && <span className="block text-xs text-muted">{r.customer_phone}</span>}</td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${CH_STYLE[r.channel] ?? "bg-cream text-muted"}`}>{r.channel}</span></td>
                      <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${cls[st]}`}>{st}</span></td>
                      <td className="p-3 text-right font-medium">{formatPaise(r.total)}</td>
                      <td className="p-3 text-right">
                        <form action={fulfillBackorderAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="px-2.5 py-1 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark whitespace-nowrap" title="Stock has arrived — mark this backorder fulfilled and count it as a normal sale">✓ Convert to sale</button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  );
}
