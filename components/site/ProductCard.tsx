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
  image?: string | null;
  wholesale_override?: number | null; retail_override?: number | null; mrp_override?: number | null;
  /** Available colour variants — shown as swatch dots on the card (like the old blythediva.com). */
  colors?: string[];
};

// Best-effort swatch colour: CSS understands common names (gold, maroon, teal…); Indian trade
// names (feroji, rani…) get a mapped hex; anything unknown falls back to a neutral chip.
const SWATCH: Record<string, string> = {
  feroji: "#3AAFA9", rani: "#E0115F", gajri: "#F88379", mehendi: "#7A8B3A", "peacock": "#0F6B72",
  "baby pink": "#F4C2C2", "blush pink": "#E8A9A9", "off white": "#FAF6EE", oxidised: "#8a8f98", antique: "#9C7A3C",
};
function swatchCss(name: string): string {
  const n = name.trim().toLowerCase();
  if (SWATCH[n]) return SWATCH[n];
  const el = ["red","blue","green","gold","silver","white","black","pink","purple","maroon","orange","yellow","grey","gray","teal","navy","peach","cream","brown","magenta","violet","turquoise","coral","ivory","mint","wine","copper"].find((c) => n.includes(c));
  return el ?? "#d8cfc0";
}

export function ProductCard({ p, formula, index = 0 }: { p: CardProduct; formula: PricingFormula; index?: number }) {
  const o = liveOffer(p.base_wholesale, formula, overridesOf(p));
  return (
    <Link href={`/shop/${p.category.slug}/${p.sku}`}
      className="group relative block rounded-2xl bg-white shadow-card hover:shadow-luxe transition-all duration-300 hover:-translate-y-1 overflow-hidden">
      <div className="relative aspect-[3/4] overflow-hidden bg-cream">
        <div className="card-img h-full w-full"><ProductImage name={p.name} src={p.image} /></div>

        <div className="absolute top-3 left-3 flex flex-col gap-1.5">
          {o.hasOffer && <span className="bg-rose text-white text-[11px] font-semibold px-2 py-1 rounded-full shadow-sm">{o.offerPct}% OFF</span>}
          {p.isNew && <span className="bg-emerald text-white text-[11px] font-semibold px-2 py-1 rounded-full">NEW</span>}
        </div>

        <WishlistButton item={{ sku: p.sku, name: p.name, category: p.category.name, categorySlug: p.category.slug, price: o.price }} className="absolute top-3 right-3 h-9 w-9 grid place-items-center rounded-full backdrop-blur opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0 transition-all" />


        <div className="absolute inset-x-3 bottom-3 opacity-0 group-hover:opacity-100 translate-y-3 group-hover:translate-y-0 transition-all duration-300">
          <AddToCart variant="card" item={{ sku: p.sku, name: p.name, price: o.price, category: p.category.slug }} />
        </div>
      </div>

      <div className="p-4">
        {p.category.name && p.category.name.toLowerCase() !== "uncategorized" && <p className="text-[10px] uppercase tracking-[0.15em] text-gold-dark">{p.category.name}</p>}
        <h3 className="text-sm font-medium text-ink leading-snug mt-0.5 line-clamp-1 group-hover:text-emerald transition-colors">{p.name}</h3>
        <div className="mt-1"><Stars rating={p.rating} count={p.reviews} /></div>
        {(p.colors?.length ?? 0) > 1 && (
          <div className="mt-1.5 flex items-center gap-1" title={p.colors!.join(", ")}>
            {p.colors!.slice(0, 5).map((c) => (
              <span key={c} className="h-3.5 w-3.5 rounded-full border border-ink/15 shadow-sm" style={{ background: swatchCss(c) }} />
            ))}
            {p.colors!.length > 5 && <span className="text-[10px] text-muted">+{p.colors!.length - 5}</span>}
          </div>
        )}
        <div className="mt-2 flex items-baseline gap-2">
          <span className="font-semibold text-ink">{formatPaise(o.price)}</span>
          {o.hasOffer && <span className="text-xs text-muted line-through">{formatPaise(o.mrp)}</span>}
          {o.hasOffer && <span className="text-xs text-emerald font-medium">Save {o.offerPct}%</span>}
        </div>
      </div>
    </Link>
  );
}
