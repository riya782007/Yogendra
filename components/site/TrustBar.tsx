const ITEMS = [
  { icon: "✦", t: "Premium Finish", s: "Anti-tarnish plating" },
  { icon: "⇆", t: "Easy 7-day Returns", s: "No questions asked" },
  { icon: "❤", t: "50,000+ Happy Customers", s: "Across India" },
  { icon: "₹", t: "COD & Secure Pay", s: "Pay your way" },
];
export function TrustBar() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-sand/60 rounded-2xl overflow-hidden">
      {ITEMS.map((i) => (
        <div key={i.t} className="bg-ivory px-5 py-5 text-center group transition-colors hover:bg-emerald-mist">
          <div className="text-gold text-xl mb-1 transition-transform group-hover:scale-110">{i.icon}</div>
          <p className="text-sm font-medium text-ink">{i.t}</p>
          <p className="text-xs text-muted">{i.s}</p>
        </div>
      ))}
    </div>
  );
}
