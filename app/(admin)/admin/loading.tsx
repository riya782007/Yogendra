/**
 * Instant loading state for every admin page. Next.js shows this the moment a menu item is tapped —
 * so the click always feels responsive (a gentle skeleton) instead of the screen appearing frozen
 * while the page's data loads. Keeps the console feeling snappy even on a slow shop connection.
 */
export default function AdminLoading() {
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen animate-pulse">
      <div className="h-8 w-56 rounded-lg bg-ink/10 mb-3" />
      <div className="h-4 w-80 rounded bg-ink/5 mb-6" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-sand bg-white shadow-card p-4">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-lg bg-ink/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded bg-ink/10" />
                <div className="h-3 w-1/2 rounded bg-ink/5" />
              </div>
              <div className="h-8 w-20 rounded-full bg-ink/5" />
            </div>
          </div>
        ))}
      </div>
      <p className="text-center text-xs text-muted mt-6">Loading…</p>
    </main>
  );
}
