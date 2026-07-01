const MESSAGES = [
  "✦ Flat 20% OFF on everything",
  "✦ Free shipping over ₹999",
  "✦ Cash on Delivery available",
  "✦ Handcrafted in Sadar Bazar, Delhi",
];
export function PromoBar() {
  const strip = [...MESSAGES, ...MESSAGES];
  return (
    <div className="bg-ink text-cream text-xs tracking-wide overflow-hidden py-2">
      <div className="marquee-track">
        {strip.map((m, i) => (
          <span key={i} className="mx-6 inline-block text-gold-light/90">{m}</span>
        ))}
      </div>
    </div>
  );
}
