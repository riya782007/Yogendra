import Link from "next/link";

type Promo = { id: string; title: string | null; image_path: string; cta_href: string | null; media_type?: string | null; category?: { slug?: string; name?: string } | null };

/**
 * Full-width promotional hero banner. The creative (AI poster OR the owner's uploaded image/video)
 * carries the offer, so it's rendered edge-to-edge and the whole banner links to the best-suited
 * section. Shows the newest published promo for the scope; renders nothing when there are none.
 */
export function PromoHero({ promos }: { promos: Promo[] }) {
  if (!promos?.length) return null;
  const p = promos[0];
  const href = p.cta_href || (p.category?.slug ? `/shop/c/${p.category.slug}` : "/shop");
  const isVideo = (p.media_type ?? "").toLowerCase() === "video";
  return (
    <Link href={href} aria-label={p.title ?? "View offer"} className="block group relative">
      {isVideo ? (
        <video src={p.image_path} className="w-full h-auto max-h-[70vh] object-cover" autoPlay muted loop playsInline preload="metadata" />
      ) : (
        <img src={p.image_path} alt={p.title ?? "Festive offer"} className="w-full h-auto max-h-[70vh] object-cover" />
      )}
      <span className="absolute bottom-3 right-3 rounded-full bg-white/90 text-ink text-xs font-medium px-3.5 py-1.5 shadow-sm opacity-90 group-hover:opacity-100 transition">
        Shop now →
      </span>
    </Link>
  );
}
