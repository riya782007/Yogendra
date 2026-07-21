const MESSAGES = [
  "✦ Flat 20% OFF on everything",
  "✦ Free shipping over ₹999",
  "✦ Cash on Delivery available",
  "✦ Anti-tarnish premium finish",
];
/** `extra` = owner-published announcement-strip promos (headlines); they lead, defaults follow. */
export function PromoBar({ extra = [] }: { extra?: string[] }) {
  const base = extra.length ? [...extra.map((m) => (m.startsWith("✦") ? m : `✦ ${m}`)), ...MESSAGES] : MESSAGES;
  const strip = [...base, ...base];
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
