export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCashBankBook, getPaymentMethods, getBankMethodTotals } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { setCashBankOpeningAction } from "@/app/actions/payments";
import { addPaymentMethodAction, deletePaymentMethodAction } from "@/app/actions/paymentMethods";

export const metadata = { title: "Owner Console · Bank & Cash" };
const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";
const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

export default async function CashBook() {
  const [b, methods, methodTotals] = await Promise.all([getCashBankBook(), getPaymentMethods(), getBankMethodTotals()]);

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Bank &amp; Cash</h1>
      <p className="text-sm text-muted mb-5">Money in hand vs in the bank. Counter cash and UPI/Razorpay collections, minus what you&apos;ve paid suppliers.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <div className={`${card} bg-emerald-mist/30`}>
          <p className="text-xs uppercase tracking-wide text-muted">💵 Cash in hand</p>
          <p className="text-2xl font-semibold text-ink mt-1">{formatPaise(b.cashBalance)}</p>
          <p className="text-[11px] text-muted mt-1">Open {formatPaise(b.opening_cash)} · in {formatPaise(b.cashIn)} · out {formatPaise(b.cashOut)}</p>
        </div>
        <div className={`${card} bg-blue-50`}>
          <p className="text-xs uppercase tracking-wide text-muted">🏦 Bank / UPI</p>
          <p className="text-2xl font-semibold text-ink mt-1">{formatPaise(b.bankBalance)}</p>
          <p className="text-[11px] text-muted mt-1">Open {formatPaise(b.opening_bank)} · in {formatPaise(b.bankIn)} · out {formatPaise(b.bankOut)}</p>
        </div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Total collected</p><p className="text-2xl font-semibold text-ink mt-1">{formatPaise(b.cashIn + b.bankIn)}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Total in hand + bank</p><p className="text-2xl font-semibold text-ink mt-1">{formatPaise(b.cashBalance + b.bankBalance)}</p></div>
      </div>

      <form action={setCashBankOpeningAction} className={`${card} flex items-end gap-3 flex-wrap mb-5`}>
        <p className="text-sm text-ink w-full font-medium">Opening balances <span className="text-muted font-normal">— set these once to your starting cash &amp; bank.</span></p>
        <label className="text-[11px] text-muted">Opening cash ₹<input name="opening_cash" type="number" min={0} step="0.01" defaultValue={b.opening_cash ? (b.opening_cash / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Opening bank ₹<input name="opening_bank" type="number" min={0} step="0.01" defaultValue={b.opening_bank ? (b.opening_bank / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
        <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
      </form>

      {/* Bank / payment methods — the accounts you collect into; picked at billing. */}
      <div className={`${card} mb-5`}>
        <p className="text-sm font-medium text-ink mb-1">Bank &amp; payment methods</p>
        <p className="text-xs text-muted mb-3">Add the banks / UPI handles you collect into. At billing, the cashier marks which one received the money, and the bank total below splits per method.</p>
        <form action={addPaymentMethodAction} className="flex flex-wrap items-end gap-2 mb-3">
          <input name="name" placeholder="e.g. R.SBI · Yogendra Industries · vardhman jewellers…" className={`${inp} flex-1 min-w-[220px]`} />
          <select name="kind" defaultValue="bank" className={inp}>
            <option value="bank">Bank</option>
            <option value="upi">UPI</option>
            <option value="wallet">Wallet</option>
          </select>
          <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">+ Add method</button>
        </form>
        {methods.length === 0 ? (
          <p className="text-sm text-muted">No methods yet — add your banks / UPI above.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {methods.map((m) => {
              const total = methodTotals.find((t) => t.method === m.name)?.total ?? 0;
              return (
                <div key={m.id} className="inline-flex items-center gap-2 rounded-full border border-sand bg-white px-3 py-1.5 text-sm">
                  <span className="text-ink font-medium">{m.name}</span>
                  <span className="text-[10px] uppercase text-muted">{m.kind}</span>
                  {total > 0 && <span className="text-emerald-dark text-xs">{formatPaise(total)}</span>}
                  <form action={deletePaymentMethodAction}><input type="hidden" name="id" value={m.id} /><button className="text-muted hover:text-rose text-xs" title="Remove method">✕</button></form>
                </div>
              );
            })}
            {methodTotals.find((t) => t.method === "Unassigned") && (
              <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/5 px-3 py-1.5 text-sm">
                <span className="text-ink">Unassigned</span>
                <span className="text-gold-dark text-xs">{formatPaise(methodTotals.find((t) => t.method === "Unassigned")!.total)}</span>
              </div>
            )}
          </div>
        )}
      </div>

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
      <p className="text-xs text-muted mt-3">Showing the latest {b.moves.length} movements. Balances above are all-time. Green = money in, red = money out.</p>
    </main>
  );
}
