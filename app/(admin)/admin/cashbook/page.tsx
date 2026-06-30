export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCashBankBook, getPaymentMethodsWithBalances, getPaymentDashboard } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { setCashBankOpeningAction } from "@/app/actions/payments";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";

export const metadata = { title: "Owner Console · Bank & Payment Methods" };
const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";
const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

export default async function CashBook() {
  const [b, methods, dash] = await Promise.all([
    getCashBankBook(),
    getPaymentMethodsWithBalances({ includeArchived: true }),
    getPaymentDashboard(),
  ]);

  const cards: { label: string; value: number; tone?: string }[] = [
    { label: "💵 Cash balance", value: dash.cashBalance, tone: "bg-emerald-mist/30" },
    { label: "🏦 Bank balance", value: dash.bankBalance, tone: "bg-blue-50" },
    { label: "📱 UPI / Wallet", value: dash.upiBalance, tone: "bg-violet-50" },
    { label: "↗ Today's collections", value: dash.todayCollections },
    { label: "↘ Today's payments", value: dash.todayPayments },
    { label: "Net cash position", value: dash.netPosition },
    { label: "Σ Total across accounts", value: dash.totalAcross, tone: "bg-gold/10" },
  ];

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Bank &amp; Payment Methods</h1>
      <p className="text-sm text-muted mb-5">One place to manage every account &amp; tender. Active methods appear everywhere — POS, invoices, collections — automatically.</p>

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {cards.map((c) => (
          <div key={c.label} className={`${card} ${c.tone ?? ""}`}>
            <p className="text-xs uppercase tracking-wide text-muted">{c.label}</p>
            <p className={`text-2xl font-semibold mt-1 ${c.value < 0 ? "text-rose" : "text-ink"}`}>{formatPaise(c.value)}</p>
          </div>
        ))}
      </div>

      {/* Master Payment Method manager (single source of truth) */}
      <PaymentMethodsManager methods={methods} />

      {/* ---- Legacy reconciliation (kept in sync) -------------------------------------------- */}
      <details className="mb-5">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink">Legacy cash/bank reconciliation &amp; movements</summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={`${card} bg-emerald-mist/30`}>
              <p className="text-xs uppercase tracking-wide text-muted">Cash in hand (legacy)</p>
              <p className="text-2xl font-semibold text-ink mt-1">{formatPaise(b.cashBalance)}</p>
              <p className="text-[11px] text-muted mt-1">Open {formatPaise(b.opening_cash)} · in {formatPaise(b.cashIn)} · out {formatPaise(b.cashOut)}</p>
            </div>
            <div className={`${card} bg-blue-50`}>
              <p className="text-xs uppercase tracking-wide text-muted">Bank / UPI (legacy)</p>
              <p className="text-2xl font-semibold text-ink mt-1">{formatPaise(b.bankBalance)}</p>
              <p className="text-[11px] text-muted mt-1">Open {formatPaise(b.opening_bank)} · in {formatPaise(b.bankIn)} · out {formatPaise(b.bankOut)}</p>
            </div>
          </div>

          <form action={setCashBankOpeningAction} className={`${card} flex items-end gap-3 flex-wrap`}>
            <p className="text-sm text-ink w-full font-medium">Legacy opening balances <span className="text-muted font-normal">— used by the all-up reconciliation below.</span></p>
            <label className="text-[11px] text-muted">Opening cash ₹<input name="opening_cash" type="number" min={0} step="0.01" defaultValue={b.opening_cash ? (b.opening_cash / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
            <label className="text-[11px] text-muted">Opening bank ₹<input name="opening_bank" type="number" min={0} step="0.01" defaultValue={b.opening_bank ? (b.opening_bank / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
            <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-cream text-muted text-left"><tr>
                <th className="p-3">Date</th><th className="p-3">Description</th>
                <th className="p-3 text-right">Cash</th><th className="p-3 text-right">Bank / UPI</th>
              </tr></thead>
              <tbody>
                {b.moves.length === 0 && <tr><td colSpan={4} className="p-4 text-muted">No money movements yet.</td></tr>}
                {b.moves.map((m: any, i: number) => (
                  <tr key={i} className="border-t border-sand/60">
                    <td className="p-3 text-muted whitespace-nowrap">{new Date(m.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                    <td className="p-3 text-ink">{m.link ? <Link href={m.link} className="text-emerald nav-link">{m.label} ↗</Link> : m.label}</td>
                    <td className={`p-3 text-right ${m.cash < 0 ? "text-rose" : m.cash > 0 ? "text-emerald-dark" : "text-muted"}`}>{m.cash ? `${m.cash > 0 ? "+" : ""}${formatPaise(m.cash)}` : ""}</td>
                    <td className={`p-3 text-right ${m.bank < 0 ? "text-rose" : m.bank > 0 ? "text-emerald-dark" : "text-muted"}`}>{m.bank ? `${m.bank > 0 ? "+" : ""}${formatPaise(m.bank)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </main>
  );
}
