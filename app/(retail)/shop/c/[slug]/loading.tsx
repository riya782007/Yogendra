export default function ShopCollectionLoading() {
  return (
    <div className="max-w-7xl mx-auto px-5 py-8 animate-pulse">
      <div className="h-8 w-48 bg-sand/40 rounded mx-auto mb-8" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-2xl bg-white shadow-card overflow-hidden">
            <div className="aspect-[3/4] bg-sand/40" />
            <div className="p-3 space-y-2">
              <div className="h-3 w-1/3 bg-sand/40 rounded" />
              <div className="h-3 w-4/5 bg-sand/40 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
