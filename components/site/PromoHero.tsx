import Link from "next/link";

type Promo = { id: string; title: string | null; image_path: string; cta_href: string | null; category?: { slug?: string; name?: string } | null };

/**
 * Full-width promotional hero banner. The AI-generated poster already carries the offer text, so we
 * render it edge-to-edge and make the whole banner a link to the most-suited section. Shows the
 * newest published promo for the scope; renders nothing when there are none.
 */
export function PromoHero({ promos }: { promos: Promo[] }) {
  if (!promos?.length) return null;
  const p = promos[0];
  const href = p.cta_href || (p.category?.slug ? `/shop/c/${p.category.slug}` : "/shop");
  return (
    <Link href={href} aria-label={p.title ?? "View offer"} className="block group relative">
      <img src={p.image_path} alt={p.title ?? "Festive offer"} className="w-full h-auto max-h-[70vh] object-cover" />
      <span className="absolute bottom-3 right-3 rounded-full bg-white/90 text-ink text-xs font-medium px-3.5 py-1.5 shadow-sm opacity-90 group-hover:opacity-100 transition">
        Shop now →
      </span>
    </Link>
  );
}
