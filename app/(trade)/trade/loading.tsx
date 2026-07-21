/**
 * Instant skeleton for the dealer catalogue. Next shows this the moment the trade link is opened —
 * so even while the (cached) catalogue is being served, the dealer sees the page appear immediately
 * instead of a blank white screen. Perceived speed matters most on the shop's main-income page.
 */
export default function TradeLoading() {
  return (
    <div className="max-w-7xl mx-auto px-5 py-8 animate-pulse">
      <div className="h-9 w-72 rounded-lg bg-ink/10 mb-2" />
      <div className="h-4 w-96 max-w-full rounded bg-ink/5 mb-6" />
      {/* Filter bar */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-28 rounded-full bg-ink/5" />
        ))}
      </div>
      {/* Product card grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-sand bg-white shadow-card overflow-hidden">
            <div className="aspect-[3/4] bg-ink/10" />
            <div className="p-3 space-y-2">
              <div className="h-3.5 w-3/4 rounded bg-ink/10" />
              <div className="h-3 w-1/2 rounded bg-ink/5" />
              <div className="h-5 w-2/5 rounded bg-ink/10 mt-2" />
            </div>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-muted mt-8">Loading the catalogue…</p>
    </div>
  );
}
