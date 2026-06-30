export const dynamic = "force-dynamic";
import { getNotifyRequests } from "@/lib/supabase/queries";

export const metadata = { title: "Owner Console · Notify-Me" };

export default async function NotifyMe() {
  const rows = await getNotifyRequests();
  const totalRequests = rows.reduce((s, r) => s + r.count, 0);

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Notify-Me · Restock demand</h1>
      <p className="text-sm text-muted mb-5">Customers who asked to be told when an out-of-stock product is back. Restock the most-wanted first, then text these buyers.</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Products wanted</p>
          <p className="text-2xl font-semibold text-ink">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Total requests</p>
          <p className="text-2xl font-semibold text-ink">{totalRequests}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted">No restock requests yet. They appear here when a customer taps &ldquo;Notify me&rdquo; on an out-of-stock product.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.sku} className="rounded-2xl border border-sand bg-white p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-ink">{r.name} <span className="font-mono text-xs text-muted">{r.sku}</span></p>
                  <p className="text-xs text-muted">In stock now: {r.qty} · last asked {new Date(r.latest).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</p>
                </div>
                <span className="text-sm font-semibold px-3 py-1 rounded-full bg-rose/10 text-rose">{r.count} waiting</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.people.map((p, i) => (
                  <a key={i} href={p.phone ? `https://wa.me/91${p.phone.replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Good news! "${r.name}" is back in stock at Blythe Diva. 💛`)}` : undefined}
                    target="_blank" rel="noreferrer"
                    className="text-[11px] px-2 py-1 rounded-full bg-cream border border-sand text-ink hover:border-emerald">
                    {p.name}{p.phone ? ` · ${p.phone}` : ""}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
