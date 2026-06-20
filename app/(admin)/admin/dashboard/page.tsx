export const dynamic = "force-dynamic";
import Link from "next/link";
import { getDashboardData, getDashboardAnalytics } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { AnimatedNumber } from "@/components/admin/AnimatedNumber";
import { BarChart } from "@/components/admin/BarChart";
import { Donut } from "@/components/admin/Donut";

function isoDaysAgo(d: number) { return new Date(Date.now() - d * 86400000).toISOString(); }
const RANGES = [{ key: "30", days: 30 }, { key: "60", days: 60 }, { key: "90", days: 90 }];

function Tile({ label, children, sub, accent }: { label: string; children: React.ReactNode; sub?: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-card hover:shadow-luxe transition-shadow">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${accent ?? "text-ink"}`}>{children}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </div>
  );
}

export default async function Dashboard({ searchParams }: { searchParams: { range?: string } }) {
  const range = RANGES.find((r) => r.key === searchParams.range) ?? RANGES[2];
  const from = isoDaysAgo(range.days), to = new Date().toISOString();
  const [d, a] = await Promise.all([getDashboardData(from, to), getDashboardAnalytics(from, to)]);

  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-4xl text-ink">Good day, Yogendra</h1>
          <p className="text-sm text-muted">Last {range.days} days · live from your catalogue &amp; orders</p>
        </div>
        <div className="flex gap-1 bg-white rounded-full p-1 shadow-card">
          {RANGES.map((r) => (
            <a key={r.key} href={`/admin/dashboard?range=${r.key}`}
              className={`px-4 py-1.5 rounded-full text-sm transition-colors ${r.key === range.key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>{r.days}d</a>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Tile label="Revenue" accent="text-emerald" sub={`${d.orders} orders`}><AnimatedNumber value={d.revenue / 100} prefix="₹" /></Tile>
        <Tile label="Orders" sub={`${d.pos} POS · ${d.cod} COD`}><AnimatedNumber value={d.orders} /></Tile>
        <Tile label="Approved Retailers" sub={`${d.pendingApprovals} pending`}><AnimatedNumber value={d.retailers} /></Tile>
        <Tile label="Pending Approvals" accent={d.pendingApprovals ? "text-gold-dark" : undefined} sub="needs owner OTP"><AnimatedNumber value={d.pendingApprovals} /></Tile>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 mb-5">
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

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Tile label="Total Products" sub={`${d.newProducts} new`}><AnimatedNumber value={d.totalProducts} /></Tile>
        <Tile label="Categories"><AnimatedNumber value={d.categories} /></Tile>
        <Tile label="Dead Stock" accent={d.dead ? "text-rose" : undefined} sub="capital tied up"><AnimatedNumber value={d.dead} /></Tile>
        <Tile label="Low Stock" accent={d.low ? "text-gold-dark" : undefined} sub={`${d.inactive} inactive`}><AnimatedNumber value={d.low} /></Tile>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-6 shadow-card">
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
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <h2 className="font-medium text-gold-dark mb-4">⭐ Top sellers</h2>
          <ul className="text-sm divide-y divide-sand/60">
            {a.topProducts.map((p) => (
              <li key={p.name} className="flex justify-between py-2"><span className="truncate pr-2">{p.name}</span><span className="text-emerald font-medium whitespace-nowrap">{formatPaise(p.revenue)}</span></li>
            ))}
          </ul>
          <Link href="/admin/inventory" className="block mt-4 text-sm text-emerald nav-link">View full inventory →</Link>
        </div>
      </div>
    </main>
  );
}
