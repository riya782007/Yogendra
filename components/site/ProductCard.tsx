import Link from "next/link";
import { ProductImage } from "@/components/Placeholder";
import { Stars } from "./Stars";
import { AddToCart } from "@/components/cart/AddToCart";
import { WishlistButton } from "@/components/wishlist/WishlistButton";
import { formatPaise } from "@/lib/pricing";
import { liveOffer } from "@/lib/offers";
import { overridesOf } from "@/lib/pricing";
import type { PricingFormula } from "@/lib/pricing";

export type CardProduct = {
  sku: string; name: string; base_wholesale: number; qty: number;
  category: { name: string; slug: string };
  rating: number; reviews: number; isNew?: boolean;
  wholesale_override?: number | null; retail_override?: number | null; mrp_override?: number | null;
};

export function ProductCard({ p, formula, index = 0 }: { p: CardProduct; formula: PricingFormula; index?: number }) {
  const o = liveOffer(p.base_wholesale, formula, overridesOf(p));
  const low = p.qty > 0 && p.qty <= 3;
  return (
    <Link href={`/shop/${p.category.slug}/${p.sku}`}
      className="group relative block rounded-2xl bg-white shadow-card hover:shadow-luxe transition-all duration-300 hover:-translate-y-1 overflow-hidden">
      <div className="relative aspect-[4/5] overflow-hidden bg-cream">
        <div className="card-img h-full w-full"><ProductImage name={p.name} /></div>

        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {o.hasOffer && <span className="bg-rose text-white text-[11px] font-semibold px-2 py-1 rounded-full shadow-sm">{o.offerPct}% OFF</span>}
          {p.isNew && <span className="bg-emerald text-white text-[11px] font-semibold px-2 py-1 rounded-full">NEW</span>}
        </div>

        <WishlistButton item={{ sku: p.sku, name: p.name, category: p.category.name, categorySlug: p.category.slug, price: o.price }} className="absolute top-3 right-3 h-9 w-9 grid place-items-center rounded-full backdrop-blur opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all" />

        {low && <span className="absolute bottom-3 left-3 bg-ink/80 text-cream text-[10px] px-2 py-1 rounded-full">Only {p.qty} left</span>}

        <div className="absolute inset-x-3 bottom-3 opacity-0 group-hover:opacity-100 translate-y-3 group-hover:translate-y-0 transition-all duration-300">
          <AddToCart variant="card" item={{ sku: p.sku, name: p.name, price: o.price, category: p.category.slug }} />
        </div>
      </div>

      <div className="p-4">
        <p className="text-[10px] uppercase tracking-[0.15em] text-gold-dark">{p.category.name}</p>
        <h3 className="text-sm font-medium text-ink leading-snug mt-0.5 line-clamp-1 group-hover:text-emerald transition-colors">{p.name}</h3>
        <div className="mt-1"><Stars rating={p.rating} count={p.reviews} /></div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-semibold text-ink">{formatPaise(o.price)}</span>
          {o.hasOffer && <span className="text-xs text-muted line-through">{formatPaise(o.mrp)}</span>}
          {o.hasOffer && <span className="text-xs text-emerald font-medium">Save {o.offerPct}%</span>}
        </div>
      </div>
    </Link>
  );
}
