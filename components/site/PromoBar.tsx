const MESSAGES = [
  "✦ Flat 20% OFF on everything",
  "✦ Pay online & get a FREE mystery gift 🎁",
  "✦ Flat ₹100 shipping across India",
  "✦ Cash on Delivery available",
  "✦ Anti-tarnish premium finish",
  "✦ New designs added daily",
];
/** `extra` = owner-published announcement-strip promos (headlines); they lead, defaults follow.
 *  A bold gold marquee across the very top — the first thing a shopper sees. */
export function PromoBar({ extra = [] }: { extra?: string[] }) {
  const base = extra.length ? [...extra.map((m) => (m.startsWith("✦") ? m : `✦ ${m}`)), ...MESSAGES] : MESSAGES;
  const strip = [...base, ...base];
  return (
    <div className="bg-gradient-to-r from-gold-dark via-gold to-gold-dark text-ink text-[13px] font-semibold tracking-wide overflow-hidden py-2.5 shadow-sm">
      <div className="marquee-track">
        {strip.map((m, i) => (
          <span key={i} className="mx-8 inline-block">{m}</span>
        ))}
      </div>
    </div>
  );
}
