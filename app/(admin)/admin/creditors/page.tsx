export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCreditors } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";

export const metadata = { title: "Owner Console · Creditors" };

export default async function Creditors() {
  const rows = await getCreditors();
  const totalDue = rows.reduce((s, r) => s + r.outstanding, 0);

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Creditors · Outstanding</h1>
      <p className="text-sm text-muted mb-5">Customers who still owe a balance across their bills — your receivables, mostly wholesale. Open a customer for their full ledger &amp; payment history.</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Total receivable</p>
          <p className="text-2xl font-semibold text-rose">{formatPaise(totalDue)}</p>
        </div>
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Creditors</p>
          <p className="text-2xl font-semibold text-ink">{rows.length}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr>
              <th className="p-3">Customer</th>
              <th className="p-3 text-right">Open bills</th>
              <th className="p-3 text-right">Outstanding</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="p-4 text-muted">No outstanding balances — everyone's settled. 🎉</td></tr>}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-sand/60 hover:bg-cream/40">
                <td className="p-3 text-ink">{r.name}{r.phone && <span className="block text-xs text-muted">{r.phone}</span>}</td>
                <td className="p-3 text-right text-muted">{r.bills}</td>
                <td className="p-3 text-right font-semibold text-rose">{formatPaise(r.outstanding)}</td>
                <td className="p-3 text-right">{r.id && <Link href={`/admin/customer/${r.id}`} className="text-emerald nav-link text-xs">Ledger →</Link>}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-sand bg-cream/40">
                <td className="p-3 text-right text-muted" colSpan={2}>Total</td>
                <td className="p-3 text-right font-semibold text-ink">{formatPaise(totalDue)}</td>
                <td className="p-3"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  );
}
