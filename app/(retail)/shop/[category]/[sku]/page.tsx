export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySku, getPricingFormula, getProductReviews, getRecommendations } from "@/lib/supabase/queries";
import { resolveProductContent } from "@/lib/content";
import { liveOffer } from "@/lib/offers";
import { formatPaise, resolvePrices, overridesOf } from "@/lib/pricing";
import { Gallery } from "@/components/site/Gallery";
import { BuyBox } from "@/components/site/BuyBox";
import { Stars } from "@/components/site/Stars";
import { Back } from "@/components/site/Back";
import { Reveal } from "@/components/site/Reveal";
import { ProductCard } from "@/components/site/ProductCard";

type Params = { params: { category: string; sku: string } };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const p = await getProductBySku(params.sku);
  if (!p) return { title: "Product not found" };
  const c = resolveProductContent({ name: p.name, sku: p.sku, categoryName: p.category?.name, colors: p.variants?.map((v) => v.color ?? "").filter(Boolean), generated_content: p.generated_content });
  return { title: c.seo.metaTitle, description: c.seo.metaDescription, keywords: c.seo.keywords, openGraph: { title: c.seo.metaTitle, description: c.seo.metaDescription } };
}

export default async function ProductPage({ params }: Params) {
  const [p, formula] = await Promise.all([getProductBySku(params.sku), getPricingFormula()]);
  if (!p) notFound();
  const [reviews, related] = await Promise.all([getProductReviews(p.id), getRecommendations(p.sku, 4)]);

  const colors = (p.variants ?? []).map((v) => v.color ?? "").filter(Boolean);
  const content = resolveProductContent({ name: p.name, sku: p.sku, categoryName: p.category?.name, colors, generated_content: p.generated_content });
  const pOv = overridesOf(p);
  const o = liveOffer(p.base_wholesale, formula, pOv);
  const w = resolvePrices(p.base_wholesale, formula, pOv);
  // Per-variant: its own photo, stock and price (variant override → product override → formula).
  const variantsForBuy = (p.variants ?? []).map((v: any) => {
    const vOv = overridesOf(v);
    const merged = { wholesale: vOv.wholesale ?? pOv.wholesale, retail: vOv.retail ?? pOv.retail, mrp: vOv.mrp ?? pOv.mrp };
    const vo = liveOffer(p.base_wholesale, formula, merged);
    const label = [v.color, v.size, v.polish].filter(Boolean).join(" · ") || v.sku;
    return { sku: v.sku, label, image: (v.image_paths?.[0] ?? null) as string | null, price: vo.price, qty: v.qty ?? 0 };
  });
  const waText = `Please place an order for ${p.name} (SKU:${p.sku})`;
  const waHref = `https://wa.me/919873151767?text=${encodeURIComponent(waText)}`;
  

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, category: p.category?.name,
    description: content.seo.metaDescription, keywords: content.seo.keywords.join(", "), brand: { "@type": "Brand", name: "Blythe Diva" },
    aggregateRating: { "@type": "AggregateRating", ratingValue: reviews.avg, reviewCount: reviews.count },
    offers: { "@type": "Offer", priceCurrency: "INR", price: (o.price / 100).toFixed(2), availability: p.qty > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };

  return (
    <div className="max-w-6xl mx-auto px-5 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="flex items-center justify-between gap-4 mb-5">
        <Back label="Back" />
        <nav className="text-xs text-muted">
          <Link href="/shop" className="hover:text-emerald">Home</Link> /{" "}
          <Link href={`/shop/c/${p.category.slug}`} className="hover:text-emerald">{p.category.name}</Link> / <span className="text-ink">{p.sku}</span>
        </nav>
      </div>

      <div className="grid md:grid-cols-2 gap-10">
        <div className="animate-fadeIn"><Gallery name={p.name} images={p.images ?? []} /></div>

        <div className="md:py-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gold-dark">{p.category.name} · {p.sku}</p>
          <h1 className="font-display text-4xl text-ink mt-1 leading-tight">{content.title}</h1>
          <div className="mt-3 flex items-center gap-3">
            <Stars rating={reviews.avg} count={reviews.count} size="md" />
            <a href="#reviews" className="text-xs text-emerald nav-link">Read reviews</a>
          </div>

          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-3xl font-semibold text-ink">{formatPaise(o.price)}</span>
            {o.hasOffer && <span className="text-lg text-muted line-through">{formatPaise(o.mrp)}</span>}
            {o.hasOffer && <span className="text-sm font-semibold text-white bg-rose px-2 py-0.5 rounded-full">{o.offerPct}% OFF</span>}
          </div>
          <p className="text-xs text-muted mt-1">Inclusive of all taxes · You save {formatPaise(o.savings)}</p>

          <BuyBox variants={variantsForBuy} waText={waText} waHref={waHref} item={{ sku: p.sku, name: p.name, price: o.price, category: p.category.slug }} />

          <div className="mt-7 border-t border-sand pt-5">
            <p className="text-ink/80 leading-relaxed">{content.description}</p>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink mb-2">Specifications</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {Object.entries(content.specs).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-ink/90">{v}</dd></div>
              ))}
            </dl>
          </div>

          {content.tags && content.tags.length > 0 && (
            <div className="mt-6">
              <h3 className="text-xs uppercase tracking-wide text-muted mb-2">Style & tags</h3>
              <div className="flex flex-wrap gap-2">
                {content.tags.slice(0, 12).map((t) => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-full bg-cream text-ink/70 border border-sand">{t}</span>
                ))}
              </div>
            </div>
          )}
          <p className="mt-6 text-xs text-muted">Wholesale rate: {formatPaise(w.wholesaleRate)} · MOQ applies · <Link href="/wholesale" className="text-emerald nav-link">Retailer? See trade pricing</Link></p>
        </div>
      </div>

      {/* REVIEWS */}
      <section id="reviews" className="mt-16 grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h2 className="font-display text-3xl text-ink">Customer Reviews</h2>
          <div className="mt-3 flex items-end gap-3">
            <span className="text-5xl font-semibold text-ink">{reviews.avg}</span>
            <div className="pb-1"><Stars rating={reviews.avg} /><p className="text-xs text-muted mt-1">{reviews.count} verified reviews</p></div>
          </div>
          <div className="mt-4 space-y-1.5">
            {[5, 4, 3, 2, 1].map((s) => {
              const pct = reviews.count ? Math.round(((reviews.dist[s] ?? 0) / reviews.count) * 100) : 0;
              return (
                <div key={s} className="flex items-center gap-2 text-xs">
                  <span className="w-6 text-muted">{s}★</span>
                  <div className="flex-1 h-2 rounded-full bg-cream overflow-hidden"><div className="h-full bg-gold" style={{ width: `${pct}%` }} /></div>
                  <span className="w-8 text-right text-muted">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="md:col-span-2 space-y-4">
          {reviews.list.length === 0 && <p className="text-sm text-muted">Be the first to review this design.</p>}
          {reviews.list.map((r) => (
            <Reveal key={r.id}>
              <div className="bg-white rounded-2xl p-5 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{r.author_name} <span className="text-muted font-normal text-xs">· verified buyer</span></p>
                  <Stars rating={r.rating} />
                </div>
                {r.body && <p className="text-ink/80 mt-2 leading-relaxed">“{r.body}”</p>}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* RELATED */}
      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-3xl text-ink mb-6">You may also love</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {related.map((rp, i) => (<Reveal key={rp.sku} delay={i * 70}><ProductCard p={rp as any} formula={formula} /></Reveal>))}
          </div>
        </section>
      )}
    </div>
  );
}
