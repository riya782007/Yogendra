const ITEMS = [
  { icon: "✦", t: "Premium Finish", s: "Anti-tarnish plating" },
  { icon: "⇆", t: "Easy 7-day Returns", s: "No questions asked" },
  { icon: "❤", t: "50,000+ Happy Customers", s: "Across India" },
  { icon: "₹", t: "COD & Secure Pay", s: "Pay your way" },
];
export function TrustBar() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
      {ITEMS.map((i) => (
        <div
          key={i.t}
          className="group relative bg-white rounded-2xl border border-sand/70 px-5 py-6 text-center shadow-card hover:shadow-luxe hover:border-gold/50 hover:-translate-y-1 transition-all duration-300"
        >
          <div className="mx-auto mb-2.5 grid place-items-center h-11 w-11 rounded-full bg-cream text-gold text-xl ring-1 ring-gold/20 group-hover:bg-gold group-hover:text-white group-hover:ring-gold transition-colors">
            {i.icon}
          </div>
          <p className="text-sm font-semibold text-ink">{i.t}</p>
          <p className="text-xs text-muted mt-0.5">{i.s}</p>
        </div>
      ))}
    </div>
  );
}
