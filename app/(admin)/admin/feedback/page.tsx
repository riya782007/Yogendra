export const dynamic = "force-dynamic";
import { getFeedback } from "@/lib/supabase/queries";

export const metadata = { title: "Owner Console · Customer Feedback" };
const ago = (d: string) => { const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export default async function FeedbackInbox() {
  const rows = await getFeedback();
  const rated = rows.filter((r: any) => r.rating);
  const avg = rated.length ? rated.reduce((s: number, r: any) => s + (r.rating || 0), 0) / rated.length : 0;

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-3xl">
      <h1 className="font-display text-4xl text-ink mb-1">Customer Feedback</h1>
      <p className="text-sm text-muted mb-6">{rows.length} response{rows.length === 1 ? "" : "s"}{rated.length ? ` · average ${avg.toFixed(1)}★` : ""}. Shared from your storefront feedback form.</p>

      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted">No feedback yet. Share <code className="bg-cream px-1 rounded">/feedback</code> with customers (it’s on every invoice as a WhatsApp nudge).</p>}
        {rows.map((r: any) => (
          <div key={r.id} className="bg-white rounded-2xl p-5 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-ink">{r.name || "Anonymous"} <span className="text-xs text-muted font-normal">· {ago(r.created_at)}{r.phone ? ` · ${r.phone}` : ""}</span></p>
              {r.rating ? <span className="text-gold whitespace-nowrap">{"★".repeat(r.rating)}<span className="text-sand">{"★".repeat(5 - r.rating)}</span></span> : null}
            </div>
            {r.message && <p className="text-ink/80 mt-2 leading-relaxed">“{r.message}”</p>}
            {r.order_ref && <p className="text-xs text-muted mt-1">Order {r.order_ref}</p>}
          </div>
        ))}
      </div>
    </main>
  );
}
