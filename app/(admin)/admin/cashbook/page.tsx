export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCashBankBook, getCashBankLedger, getPaymentMethodsWithBalances, getPaymentDashboard } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { setCashBankOpeningAction } from "@/app/actions/payments";
import { PaymentMethodsManager } from "@/components/admin/PaymentMethodsManager";

export const metadata = { title: "Owner Console · Bank & Payment Methods" };
const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";
const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

type Move = { date: string; label: string; link: string | null; cash: number; bank: number; method: string | null };
type Tender = "all" | "cash" | "bank";

export default async function CashBook({ searchParams }: { searchParams: { tender?: string; from?: string; to?: string } }) {
  const tender: Tender = searchParams.tender === "cash" ? "cash" : searchParams.tender === "bank" ? "bank" : "all";
  const from = (searchParams.from ?? "").trim();
  const to = (searchParams.to ?? "").trim();

  const [b, methods, dash, ledger] = await Promise.all([
    getCashBankBook(),
    getPaymentMethodsWithBalances({ includeArchived: true }),
    getPaymentDashboard(),
    getCashBankLedger({ from: from || undefined, to: to ? to + "T23:59:59" : undefined }),
  ]);

  // ---- filter by tender (cash-only shows rows with a cash leg; bank-only shows a bank leg) ----
  const moves: Move[] = ledger.moves.filter((m) => tender === "cash" ? m.cash !== 0 : tender === "bank" ? m.bank !== 0 : (m.cash !== 0 || m.bank !== 0));

  // ---- totals for the chosen range ----
  const sum = moves.reduce((a, m) => {
    if (m.cash > 0) a.cashIn += m.cash; else a.cashOut += -m.cash;
    if (m.bank > 0) a.bankIn += m.bank; else a.bankOut += -m.bank;
    return a;
  }, { cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 });

  // ---- which bank/account did the money go into (collections only) ----
  const methodMap = new Map<string, number>();
  for (const m of moves) if (m.bank > 0 && m.method) methodMap.set(m.method, (methodMap.get(m.method) ?? 0) + m.bank);
  const methodRows = [...methodMap.entries()].map(([method, total]) => ({ method, total })).sort((x, y) => y.total - x.total);

  // ---- day-wise grouping ----
  const dayMap = new Map<string, { items: Move[]; cashIn: number; cashOut: number; bankIn: number; bankOut: number }>();
  for (const m of moves) {
    const day = new Date(m.date).toLocaleDateString("en-CA"); // YYYY-MM-DD, local
    const d = dayMap.get(day) ?? { items: [], cashIn: 0, cashOut: 0, bankIn: 0, bankOut: 0 };
    d.items.push(m);
    if (m.cash > 0) d.cashIn += m.cash; else d.cashOut += -m.cash;
    if (m.bank > 0) d.bankIn += m.bank; else d.bankOut += -m.bank;
    dayMap.set(day, d);
  }
  const days = [...dayMap.entries()].sort((x, y) => y[0].localeCompare(x[0]));

  // ---- filter helpers (preserve the other params) ----
  const href = (next: Partial<{ tender: Tender; from: string; to: string }>) => {
    const p = new URLSearchParams();
    const t = next.tender ?? tender; if (t !== "all") p.set("tender", t);
    const f = next.from ?? from; if (f) p.set("from", f);
    const tt = next.to ?? to; if (tt) p.set("to", tt);
    const s = p.toString();
    return `/admin/cashbook${s ? `?${s}` : ""}`;
  };
  const iso = (d: Date) => d.toLocaleDateString("en-CA");
  const now = new Date();
  const todayStr = iso(now);
  const monthStart = iso(new Date(now.getFullYear(), now.getMonth(), 1));
  const weekStart = iso(new Date(now.getTime() - 6 * 86400000));
  const rangeLabel = from || to ? `${from || "start"} → ${to || "today"}` : "All time";

  const cards: { label: string; value: number; tone?: string }[] = [
    { label: "💵 Cash balance", value: dash.cashBalance, tone: "bg-emerald-mist/30" },
    { label: "🏦 Bank balance", value: dash.bankBalance, tone: "bg-blue-50" },
    { label: "📱 UPI / Wallet", value: dash.upiBalance, tone: "bg-violet-50" },
    { label: "Σ Total across accounts", value: dash.totalAcross, tone: "bg-gold/10" },
  ];

  const tenderTab = (key: Tender, label: string) =>
    `px-4 py-1.5 rounded-full text-sm transition-colors ${tender === key ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-emerald"}`;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Bank &amp; Payment Methods</h1>
      <p className="text-sm text-muted mb-5">Counter cash and UPI / bank collections, minus what you've paid suppliers. Filter to just cash or just bank, see it day by day, and which bank each rupee went into.</p>

      {/* Account balances */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.label} className={`${card} ${c.tone ?? ""}`}>
            <p className="text-xs uppercase tracking-wide text-muted">{c.label}</p>
            <p className={`sensitive text-2xl font-semibold mt-1 ${c.value < 0 ? "text-rose" : "text-ink"}`}>{formatPaise(c.value)}</p>
          </div>
        ))}
      </div>

      {/* ================= CASH & BANK BOOK ================= */}
      <section className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold text-ink">Cash &amp; Bank book <span className="text-sm font-normal text-muted">· {rangeLabel}</span></h2>
          {/* Tender heads — click to see ONLY cash or ONLY bank */}
          <div className="flex gap-1.5">
            <Link href={href({ tender: "all" })} className={tenderTab("all", "All")}>All</Link>
            <Link href={href({ tender: "cash" })} className={tenderTab("cash", "Cash")}>💵 Cash</Link>
            <Link href={href({ tender: "bank" })} className={tenderTab("bank", "Bank")}>🏦 Bank / UPI</Link>
          </div>
        </div>

        {/* Date filter + presets */}
        <form action="/admin/cashbook" className="flex flex-wrap items-end gap-2 mb-4">
          <input type="hidden" name="tender" value={tender} />
          <label className="text-[11px] text-muted">From<input type="date" name="from" defaultValue={from} className={`${inp} block mt-0.5`} /></label>
          <label className="text-[11px] text-muted">To<input type="date" name="to" defaultValue={to} className={`${inp} block mt-0.5`} /></label>
          <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Apply</button>
          <Link href={href({ from: todayStr, to: todayStr })} className="px-3 py-2 rounded-xl bg-white border border-sand text-sm text-muted hover:border-emerald">Today</Link>
          <Link href={href({ from: weekStart, to: todayStr })} className="px-3 py-2 rounded-xl bg-white border border-sand text-sm text-muted hover:border-emerald">7 days</Link>
          <Link href={href({ from: monthStart, to: todayStr })} className="px-3 py-2 rounded-xl bg-white border border-sand text-sm text-muted hover:border-emerald">This month</Link>
          {(from || to) && <Link href={href({ from: "", to: "" })} className="px-3 py-2 text-sm text-muted hover:text-ink">Clear dates</Link>}
        </form>

        {/* Range totals */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {tender !== "bank" && <>
            <div className={`${card} bg-emerald-mist/30`}><p className="text-xs uppercase tracking-wide text-muted">Cash in</p><p className="sensitive text-xl font-semibold text-emerald-dark mt-1">{formatPaise(sum.cashIn)}</p></div>
            <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Cash out</p><p className="sensitive text-xl font-semibold text-rose mt-1">{formatPaise(sum.cashOut)}</p></div>
          </>}
          {tender !== "cash" && <>
            <div className={`${card} bg-blue-50`}><p className="text-xs uppercase tracking-wide text-muted">Bank / UPI in</p><p className="sensitive text-xl font-semibold text-emerald-dark mt-1">{formatPaise(sum.bankIn)}</p></div>
            <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Bank / UPI out</p><p className="sensitive text-xl font-semibold text-rose mt-1">{formatPaise(sum.bankOut)}</p></div>
          </>}
        </div>

        {/* Which bank did it go into */}
        {tender !== "cash" && methodRows.length > 0 && (
          <div className={`${card} mb-4`}>
            <h3 className="font-medium text-ink mb-2">Which bank / account collected</h3>
            <div className="flex flex-wrap gap-2">
              {methodRows.map((r) => (
                <div key={r.method} className="rounded-xl border border-sand bg-cream/40 px-4 py-2">
                  <p className="text-xs text-muted">{r.method}</p>
                  <p className="sensitive text-lg font-semibold text-ink">{formatPaise(r.total)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Day-wise transactions */}
        {days.length === 0 ? (
          <div className={card}><p className="text-sm text-muted">No {tender === "all" ? "" : tender + " "}movements in this period.</p></div>
        ) : (
          <div className="space-y-3">
            {days.map(([day, d]) => (
              <div key={day} className="rounded-2xl border border-sand bg-white shadow-card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 bg-cream/60 px-4 py-2.5">
                  <p className="font-medium text-ink">{new Date(day).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", year: "2-digit" })}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                    {tender !== "bank" && <span className="text-muted">Cash in <b className="text-emerald-dark">{formatPaise(d.cashIn)}</b>{d.cashOut > 0 && <> · out <b className="text-rose">{formatPaise(d.cashOut)}</b></>}</span>}
                    {tender !== "cash" && <span className="text-muted">Bank in <b className="text-emerald-dark">{formatPaise(d.bankIn)}</b>{d.bankOut > 0 && <> · out <b className="text-rose">{formatPaise(d.bankOut)}</b></>}</span>}
                  </div>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {d.items.map((m, i) => (
                      <tr key={i} className="border-t border-sand/60">
                        <td className="px-4 py-2 text-ink">
                          {m.link ? <Link href={m.link} className="text-emerald nav-link">{m.label} ↗</Link> : m.label}
                          {m.bank > 0 && m.method && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">{m.method}</span>}
                        </td>
                        {tender !== "bank" && <td className={`px-3 py-2 text-right whitespace-nowrap ${m.cash < 0 ? "text-rose" : m.cash > 0 ? "text-emerald-dark" : "text-muted/40"}`}>{m.cash ? `${m.cash > 0 ? "+" : ""}${formatPaise(m.cash)}` : "—"}</td>}
                        {tender !== "cash" && <td className={`px-4 py-2 text-right whitespace-nowrap ${m.bank < 0 ? "text-rose" : m.bank > 0 ? "text-emerald-dark" : "text-muted/40"}`}>{m.bank ? `${m.bank > 0 ? "+" : ""}${formatPaise(m.bank)}` : "—"}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Master Payment Method manager (single source of truth) */}
      <PaymentMethodsManager methods={methods} />

      {/* ---- Legacy reconciliation (kept in sync) -------------------------------------------- */}
      <details className="mb-5">
        <summary className="cursor-pointer text-sm text-muted hover:text-ink">Legacy cash/bank reconciliation &amp; opening balances</summary>
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className={`${card} bg-emerald-mist/30`}>
              <p className="text-xs uppercase tracking-wide text-muted">Cash in hand (legacy)</p>
              <p className="sensitive text-2xl font-semibold text-ink mt-1">{formatPaise(b.cashBalance)}</p>
              <p className="text-[11px] text-muted mt-1">Open {formatPaise(b.opening_cash)} · in {formatPaise(b.cashIn)} · out {formatPaise(b.cashOut)}</p>
            </div>
            <div className={`${card} bg-blue-50`}>
              <p className="text-xs uppercase tracking-wide text-muted">Bank / UPI (legacy)</p>
              <p className="sensitive text-2xl font-semibold text-ink mt-1">{formatPaise(b.bankBalance)}</p>
              <p className="text-[11px] text-muted mt-1">Open {formatPaise(b.opening_bank)} · in {formatPaise(b.bankIn)} · out {formatPaise(b.bankOut)}</p>
            </div>
          </div>

          <form action={setCashBankOpeningAction} className={`${card} flex items-end gap-3 flex-wrap`}>
            <p className="text-sm text-ink w-full font-medium">Legacy opening balances <span className="text-muted font-normal">— used by the all-up reconciliation.</span></p>
            <label className="text-[11px] text-muted">Opening cash ₹<input name="opening_cash" type="number" min={0} step="0.01" defaultValue={b.opening_cash ? (b.opening_cash / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
            <label className="text-[11px] text-muted">Opening bank ₹<input name="opening_bank" type="number" min={0} step="0.01" defaultValue={b.opening_bank ? (b.opening_bank / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-32 block mt-0.5`} /></label>
            <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
          </form>
        </div>
      </details>
    </main>
  );
}
