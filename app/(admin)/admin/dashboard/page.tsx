export const dynamic = "force-dynamic";
import Link from "next/link";
import { getDashboardData, getDashboardAnalytics, getChannelReport } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { AnimatedNumber } from "@/components/admin/AnimatedNumber";
import { BarChart } from "@/components/admin/BarChart";
import { Donut } from "@/components/admin/Donut";
import { ExpandableReport } from "@/components/admin/ExpandableReport";
import { PrivacyShield } from "@/components/admin/PrivacyShield";

const CH_LABEL: Record<string, string> = { retail: "Online retail", wholesale: "Wholesale", pos: "Counter (POS)" };
const PRESETS = [{ key: "today", label: "Today" }, { key: "week", label: "This week" }, { key: "month", label: "This month" }];

function presetRange(preset: string): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  if (preset === "today") start.setHours(0, 0, 0, 0);
  else if (preset === "week") { const day = (now.getDay() + 6) % 7; start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0); }
  else { start.setDate(1); start.setHours(0, 0, 0, 0); } // month
  return { from: start.toISOString(), to: now.toISOString() };
}

function Tile({ label, children, sub, accent, icon, bar }: { label: string; children: React.ReactNode; sub?: string; accent?: string; icon?: string; bar?: string }) {
  return (
    <div className="relative bg-white rounded-2xl p-5 shadow-card hover:shadow-luxe transition-all hover:-translate-y-0.5 overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${bar ?? "bg-emerald"}`} />
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
        {icon && <span className="text-gold-dark/70 text-lg">{icon}</span>}
      </div>
      <p className={`text-2xl font-semibold mt-1 ${accent ?? "text-ink"}`}>{children}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: { preset?: string; from?: string; to?: string; denied?: string } }) {
  const custom = !!(searchParams.from && searchParams.to);
  const preset = PRESETS.find((p) => p.key === searchParams.preset)?.key ?? (custom ? "custom" : "month");
  // Interpret the picked dates as IST (the business runs in India). Without a fixed offset
  // the server's own timezone shifted the day boundaries, so a selected range could miss a
  // day's orders or appear empty. +05:30 pins the range to the Indian business day.
  const r = custom
    ? { from: new Date(searchParams.from + "T00:00:00+05:30").toISOString(), to: new Date(searchParams.to + "T23:59:59+05:30").toISOString() }
    : presetRange(preset);
  const { from, to } = r;
  // Always prefill the pickers with the active window (even for presets) so the
  // owner can see exactly which dates the figures cover — the earlier blank-box confusion.
  const fromDate = searchParams.from ?? from.slice(0, 10);
  const toDate = searchParams.to ?? to.slice(0, 10);
  const [d, a, report] = await Promise.all([getDashboardData(from, to), getDashboardAnalytics(from, to), getChannelReport(from, to)]);
  const label = custom
    ? `${new Date(from).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} – ${new Date(to).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`
    : (PRESETS.find((p) => p.key === preset)?.label ?? "This month");
  const sel = "rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm outline-none focus:border-emerald";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      {searchParams.denied && (
        <div className="mb-4 rounded-xl bg-rose/10 text-rose px-4 py-2.5 text-sm">Your role doesn't have access to <b>{searchParams.denied}</b>. Ask the owner if you need it.</div>
      )}
      <PrivacyShield>
      {/* Hero */}
      <div className="relative rounded-3xl overflow-hidden mb-6 bg-gradient-to-br from-ink via-[#2c2238] to-emerald-dark text-cream p-6 sm:p-8 shadow-luxe">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-gold/20 blur-2xl" />
        <div className="absolute right-20 bottom-0 w-32 h-32 rounded-full bg-emerald/30 blur-2xl" />
        <div className="relative flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <p className="text-[11px] tracking-[0.3em] uppercase text-gold-light">Owner Console</p>
            <h1 className="font-display text-4xl sm:text-5xl text-ivory mt-1">{greet}, Yogendra</h1>
            <p className="text-sm text-cream/70 mt-1">Showing <b className="text-ivory">{label}</b> · live from your catalogue &amp; orders</p>
            <p className="text-2xl font-semibold text-ivory mt-3"><span className="sensitive">{formatPaise(d.revenue)}</span> <span className="text-sm font-normal text-cream/60">in revenue · {d.orders} orders</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-white/10 rounded-full p-1">
              {PRESETS.map((p) => (
                <a key={p.key} href={`/admin/dashboard?preset=${p.key}`}
                  className={`px-3.5 py-1.5 rounded-full text-sm transition-colors ${!custom && preset === p.key ? "bg-ivory text-ink" : "text-cream/80 hover:text-white"}`}>{p.label}</a>
              ))}
            </div>
            <form action="/admin/dashboard" className="flex items-center gap-1.5 bg-white/10 rounded-full p-1.5">
              <input type="date" name="from" defaultValue={fromDate} className={`${sel} bg-white/90`} />
              <span className="text-cream/60 text-xs">→</span>
              <input type="date" name="to" defaultValue={toDate} className={`${sel} bg-white/90`} />
              <button className="px-3 py-1.5 rounded-full bg-gold text-ink text-sm font-medium">Apply</button>
            </form>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Tile label="Revenue" icon="₹" accent="text-emerald" bar="bg-emerald" sub={`${d.orders} orders`}><span className="sensitive"><AnimatedNumber value={d.revenue / 100} prefix="₹" /></span></Tile>
        <Tile label="Orders" icon="❑" bar="bg-gold" sub={`${d.pos} POS · ${d.cod} COD`}><AnimatedNumber value={d.orders} /></Tile>
        <Tile label="Approved Retailers" icon="♚" bar="bg-wine" sub={`${d.pendingApprovals} pending`}><AnimatedNumber value={d.retailers} /></Tile>
        <Tile label="Pending Approvals" icon="✓" accent={d.pendingApprovals ? "text-gold-dark" : undefined} bar={d.pendingApprovals ? "bg-gold-dark" : "bg-sand"} sub="needs owner OTP"><AnimatedNumber value={d.pendingApprovals} /></Tile>
      </div>

      {/* Collections split — cash in hand vs bank/UPI (#14/#37) */}
      <div className="grid grid-cols-2 gap-4 mb-5 sensitive">
        <Tile label="Cash collected" icon="₹" accent="text-emerald" bar="bg-emerald" sub="counter cash">{formatPaise(d.cashCollected)}</Tile>
        <Tile label="UPI / Bank collected" icon="🏦" bar="bg-wine" sub="online & card">{formatPaise(d.bankCollected)}</Tile>
      </div>

      {/* Expandable channel reports — headline number, click to see the full report for the range */}
      <div className="mb-5">
        <p className="text-sm text-muted mb-2">Sales by channel — <span className="text-ink">tap any card to expand the full report for {label.toLowerCase()}</span></p>
        <div className="grid md:grid-cols-3 gap-4 sensitive">
          {report.channels.map((c) => (
            <ExpandableReport key={c.channel} title={CH_LABEL[c.channel] ?? c.channel} channelKey={c.channel}
              revenue={c.revenue} count={c.count} orders={c.orders} from={fromDate} to={toDate}
              accent={c.channel === "pos" ? "text-emerald" : undefined} />
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-5 sensitive">
        <div className="lg:col-span-2 bg-white rounded-2xl p-6 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-medium text-ink">Revenue trend</h2>
            <span className="text-xs text-muted">8 weeks</span>
          </div>
          <BarChart data={a.weekly} />
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <h2 className="font-medium text-ink mb-4">Sales by channel</h2>
          <Donut data={a.channels.map((c) => ({ label: c.channel, value: c.revenue }))} />
        </div>
      </div>

      <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
        <Tile label="Total Products" sub={`${d.newProducts} new`}><AnimatedNumber value={d.totalProducts} /></Tile>
        <Tile label="Categories"><AnimatedNumber value={d.categories} /></Tile>
        <Tile label="Dead Stock" accent={d.dead ? "text-rose" : undefined} sub="no movement · capital tied up"><AnimatedNumber value={d.dead} /></Tile>
        <Tile label="Low Stock" accent={d.low ? "text-gold-dark" : undefined} sub="at/under reorder level"><AnimatedNumber value={d.low} /></Tile>
        <Tile label="Inactive" accent={d.inactive ? "text-muted" : undefined} sub="never sold"><AnimatedNumber value={d.inactive} /></Tile>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-card sensitive">
          <h2 className="font-medium text-ink mb-4">Revenue by category</h2>
          <div className="space-y-3">
            {a.categories.map((c, i) => {
              const max = Math.max(1, ...a.categories.map((x) => x.revenue));
              return (
                <div key={c.name}>
                  <div className="flex justify-between text-sm mb-1"><span className="text-ink/80">{c.name}</span><span className="text-muted">{formatPaise(c.revenue)}</span></div>
                  <div className="h-2.5 rounded-full bg-cream overflow-hidden"><div className="h-full bar-grow bg-gradient-to-r from-emerald to-gold" style={{ width: `${(c.revenue / max) * 100}%`, animationDelay: `${i * 90}ms` }} /></div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <h2 className="font-medium text-rose mb-4">🔴 Dead stock — act now</h2>
          <ul className="text-sm divide-y divide-sand/60">
            {d.deadList.length === 0 ? <li className="py-2 text-muted">None 🎉</li> : d.deadList.map((p) => (
              <li key={p.sku} className="flex justify-between py-2"><span>{p.name}</span><span className="text-muted">{p.qty} pcs</span></li>
            ))}
          </ul>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-card sensitive">
          <h2 className="font-medium text-gold-dark mb-4">⭐ Top sellers</h2>
          <ul className="text-sm divide-y divide-sand/60">
            {a.topProducts.map((p) => (
              <li key={p.name} className="flex justify-between py-2"><span className="truncate pr-2">{p.name}</span><span className="text-emerald font-medium whitespace-nowrap">{formatPaise(p.revenue)}</span></li>
            ))}
          </ul>
          <Link href="/admin/inventory" className="block mt-4 text-sm text-emerald nav-link">View full inventory →</Link>
        </div>
      </div>
      </PrivacyShield>
    </main>
  );
}
