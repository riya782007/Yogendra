/** Instant skeleton for the storefront home — shown while the (cached) catalogue is fetched, so the
 *  page paints immediately instead of waiting on data. Mirrors the real hero + category + product grid. */
export default function ShopLoading() {
  const Card = () => (
    <div className="rounded-2xl bg-white shadow-card overflow-hidden">
      <div className="aspect-[3/4] bg-sand/40 animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-3 w-1/3 bg-sand/40 rounded animate-pulse" />
        <div className="h-3 w-4/5 bg-sand/40 rounded animate-pulse" />
        <div className="h-3 w-1/2 bg-sand/40 rounded animate-pulse" />
      </div>
    </div>
  );
  return (
    <>
      {/* hero */}
      <section className="bg-gradient-to-b from-cream to-ivory">
        <div className="max-w-7xl mx-auto px-5 py-14 md:py-20 grid md:grid-cols-2 gap-10 items-center">
          <div className="space-y-4">
            <div className="h-3 w-40 bg-sand/40 rounded animate-pulse" />
            <div className="h-12 w-4/5 bg-sand/40 rounded-lg animate-pulse" />
            <div className="h-4 w-2/3 bg-sand/40 rounded animate-pulse" />
            <div className="h-11 w-44 bg-sand/50 rounded-full animate-pulse" />
          </div>
          <div className="h-[360px] md:h-[440px] bg-sand/30 rounded-3xl animate-pulse" />
        </div>
      </section>

      {/* categories */}
      <section className="max-w-7xl mx-auto px-5 py-16">
        <div className="h-8 w-56 bg-sand/40 rounded mx-auto mb-8 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="aspect-[4/3] rounded-2xl bg-sand/30 animate-pulse" />)}
        </div>
      </section>

      {/* products */}
      <section className="max-w-7xl mx-auto px-5 py-8">
        <div className="h-8 w-48 bg-sand/40 rounded mb-7 animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => <Card key={i} />)}
        </div>
      </section>
    </>
  );
}
