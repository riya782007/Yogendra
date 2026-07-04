export const dynamic = "force-dynamic";
import { getWholesaleQuoteRequests } from "@/lib/supabase/queries";
import { setQuoteStatusAction } from "@/app/actions/wholesale";

export const metadata = { title: "Owner Console · Quote Requests" };

export default async function QuoteRequests() {
  const rows = await getWholesaleQuoteRequests();
  const open = rows.filter((r) => r.status === "open");

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Quote Requests · Wholesale</h1>
      <p className="text-sm text-muted mb-5">Bulk &amp; custom-order enquiries from your trade dealers. Reply on WhatsApp with your best price, then mark them done.</p>

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Open requests</p>
          <p className="text-2xl font-semibold text-ink">{open.length}</p>
        </div>
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Total received</p>
          <p className="text-2xl font-semibold text-ink">{rows.length}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted">No quote requests yet. They appear here when a dealer taps &ldquo;Request a quote&rdquo; in the Trade Portal.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => {
            const wa = r.dealerPhone ? `https://wa.me/91${r.dealerPhone.replace(/\D/g, "").slice(-10)}` : null;
            const closed = r.status !== "open";
            return (
              <div key={r.id} className={`rounded-2xl border bg-white p-4 shadow-card ${closed ? "border-sand opacity-70" : "border-gold/40"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-ink">{r.dealerName}{r.dealerPhone ? <span className="text-xs text-muted font-mono"> · {r.dealerPhone}</span> : null}</p>
                    <p className="text-xs text-muted">{new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <span className={`text-xs font-semibold px-3 py-1 rounded-full ${closed ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>{closed ? "Done" : "Open"}</span>
                </div>
                <p className="mt-2 text-sm text-ink whitespace-pre-wrap">{r.details}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {wa && <a href={`${wa}?text=${encodeURIComponent(`Hi ${r.dealerName}, regarding your quote request at Blythe Diva —`)}`} target="_blank" rel="noreferrer" className="text-xs px-3 py-1.5 rounded-full bg-emerald text-white hover:bg-emerald-dark">Reply on WhatsApp</a>}
                  <form action={setQuoteStatusAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="status" value={closed ? "open" : "closed"} />
                    <button className="text-xs px-3 py-1.5 rounded-full border border-sand text-ink hover:border-gold">{closed ? "Reopen" : "Mark done"}</button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
