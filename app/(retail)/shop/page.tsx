export const dynamic = "force-dynamic";
import Link from "next/link";
import { getStorefront, getFeaturedReviews, getShoppableReels, getActivePromotions, getCategoryTree } from "@/lib/supabase/queries";
import { ProductCard } from "@/components/site/ProductCard";
import { PromoHero } from "@/components/site/PromoHero";
import { ProductImage } from "@/components/Placeholder";
import { TrustBar } from "@/components/site/TrustBar";
import { Reveal } from "@/components/site/Reveal";
import { Stars } from "@/components/site/Stars";
import { ReelsSection } from "@/components/site/ReelsSection";

export const metadata = {
  title: "Premium Artificial Jewellery — Kundan, Meena, Temple",
  description: "Shop handcrafted artificial jewellery from Blythe Diva. Necklaces, earrings, bracelets, anklets & rings with COD and free shipping over ₹999.",
};

export default async function Shop() {
  const [{ products, formula }, reviews, reels, promos, tree] = await Promise.all([getStorefront(), getFeaturedReviews(), getShoppableReels(), getActivePromotions("retail"), getCategoryTree()]);
  // Category tiles are driven by the catalogue tree, so they always show — even before
  // any products are published (the storefront starts with everything in draft).
  // Category tiles get a REAL jewellery photo automatically — the first in-stock product image in that
  // category — so the "Shop by Category" row never shows bare letter placeholders (HA / N / E).
  const catImg = new Map<string, string>();
  for (const p of products as any[]) {
    const slug = p.category?.slug; const img = p.image;
    if (slug && img && !catImg.has(slug)) catImg.set(slug, img);
  }
  const cats = tree.filter((c) => c.name?.trim().toLowerCase() !== "uncategorized").map((c) => ({ name: c.name, slug: c.slug, image: (c as any).imageUrl || catImg.get(c.slug) || null }));
  // NEW ARRIVALS — genuinely the most recently ADDED pieces (newest first).
  const createdMs = (p: any) => (p.created_at ? new Date(p.created_at).getTime() : 0);
  const trending = [...products].sort((a, b) => createdMs(b) - createdMs(a)).slice(0, 8);
  // BESTSELLERS — real top sellers once there's sales/review data; until then a curated pick that is
  // ALWAYS distinct from New Arrivals (no product appears in both), so the two rows never look identical.
  const newIds = new Set(trending.map((p) => p.sku));
  const bestsellers = [...products]
    .sort((a, b) => (b.reviews - a.reviews) || (b.rating - a.rating) || a.sku.localeCompare(b.sku))
    .filter((p) => !newIds.has(p.sku))
    .slice(0, 8);
  // Real product photos for the hero collage (falls back to a tasteful placeholder if none yet).
  const heroPics = products.filter((p) => p.image).slice(0, 3);

  return (
    <>
      {/* AI promotional poster (festive offers) — auto-placed when the owner publishes a campaign. */}
      <PromoHero promos={promos} />

      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-cream to-ivory">
        <div className="max-w-7xl mx-auto px-5 py-14 md:py-20 grid md:grid-cols-2 gap-10 items-center">
          <div className="animate-fadeUp">
            <p className="text-gold-dark tracking-[0.3em] uppercase text-xs mb-4">Blythe Diva · Fine Artificial Jewellery</p>
            <h1 className="font-display text-5xl md:text-6xl leading-[1.05] text-ink">
              Adorn your <span className="text-gold-gradient">every</span> moment.
            </h1>
            <p className="text-muted mt-5 max-w-md leading-relaxed">
              Handcrafted Kundan, Meenakari & Temple jewellery — premium anti-tarnish finish and trend-ready designs.
            </p>
            <div className="flex gap-3 mt-7">
              <Link href="#bestsellers" className="btn-primary px-7 py-3 text-sm font-medium">Shop the collection</Link>
            </div>
            <div className="flex items-center gap-6 mt-8 text-sm text-muted">
              <span>✦ Anti-tarnish finish</span><span>·</span><span>Cash on delivery</span><span>·</span><span>Free shipping over ₹999</span>
            </div>
          </div>
          <div className="relative h-[360px] md:h-[440px]">
            {[{ c: "absolute right-0 top-0 w-52 h-64 rounded-3xl overflow-hidden shadow-luxe rotate-3 animate-float", d: "0s", n: "Kundan Set" },
              { c: "absolute left-2 top-16 w-44 h-56 rounded-3xl overflow-hidden shadow-luxe -rotate-6 animate-float", d: "1s", n: "Meena Haar" },
              { c: "absolute left-28 bottom-0 w-40 h-48 rounded-3xl overflow-hidden shadow-gold rotate-2 animate-float", d: "2s", n: "Jhumka" }].map((s, i) => (
              <div key={i} className={s.c} style={{ animationDelay: s.d }}>
                {heroPics[i]?.image
                  ? <img src={heroPics[i].image!} alt={heroPics[i].name} className="w-full h-full object-cover" />
                  : <ProductImage name={s.n} />}
              </div>
            ))}
            <div className="absolute right-10 bottom-6 h-20 w-20 rounded-full border border-gold/40 animate-spinSlow" />
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-5 -mt-6 relative z-10"><TrustBar /></section>

      {/* CATEGORIES */}
      <section className="max-w-7xl mx-auto px-5 py-16">
        <Reveal>
          <div className="text-center mb-8">
            <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Find your style</p>
            <h2 className="font-display text-4xl text-ink mt-1">Shop by Category</h2>
          </div>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          {cats.map((c, i) => (
            <Reveal key={c.slug} delay={i * 70}>
              <Link href={`/shop/c/${c.slug}`} className="group block rounded-2xl overflow-hidden bg-white shadow-card hover:shadow-luxe transition-all hover:-translate-y-1">
                <div className="aspect-[4/3] overflow-hidden">
                  {c.image
                    ? <img src={c.image} alt={c.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    : <div className="card-img h-full w-full"><ProductImage name={c.name} /></div>}
                </div>
                <p className="text-center py-4 text-base font-medium text-ink group-hover:text-emerald transition-colors">{c.name}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* BESTSELLERS — shown once designs are published */}
      {bestsellers.length > 0 && (
      <section id="bestsellers" className="max-w-7xl mx-auto px-5 py-8 scroll-mt-24">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Loved by thousands</p>
            <h2 className="font-display text-4xl text-ink mt-1">Bestsellers</h2>
          </div>
          <Link href="/shop" className="nav-link text-sm text-emerald">View all →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {bestsellers.map((p, i) => (
            <Reveal key={p.sku} delay={(i % 4) * 80}><ProductCard p={p as any} formula={formula} index={i} /></Reveal>
          ))}
        </div>
      </section>
      )}

      {/* Curation note — only while the catalogue is still in draft (no products live yet) */}
      {products.length === 0 && (
        <section className="max-w-3xl mx-auto px-5 py-16 text-center">
          <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Arriving soon</p>
          <h2 className="font-display text-4xl text-ink mt-2">Our new collection is being styled</h2>
          <p className="text-muted mt-3 leading-relaxed">Thousands of handcrafted Kundan, Meenakari, Temple and American-diamond designs are being photographed and readied. Browse by category above — pieces go live daily.</p>
          <div className="flex flex-wrap gap-3 justify-center mt-6">
            {cats.map((c) => (
              <Link key={c.slug} href={`/shop/c/${c.slug}`} className="px-5 py-2 rounded-full border border-sand text-ink hover:border-emerald hover:text-emerald transition-colors text-sm">{c.name}</Link>
            ))}
          </div>
        </section>
      )}

      {/* BRAND BANNER — evergreen craft message (real offers are run via the Promotions engine) */}
      <section className="max-w-7xl mx-auto px-5 py-12">
        <Reveal>
          <div className="rounded-3xl bg-ink text-cream px-8 py-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(circle at 20% 20%, #C8A24C, transparent 40%), radial-gradient(circle at 80% 80%, #0F5C4D, transparent 40%)" }} />
            <p className="relative text-gold-light tracking-[0.3em] uppercase text-xs">The Blythe Diva Promise</p>
            <h2 className="relative font-display text-4xl md:text-5xl mt-2">Handcrafted. Anti-tarnish. Made to shine.</h2>
            <p className="relative text-cream/70 mt-3">Free shipping over ₹999 · Cash on delivery · Easy 7-day returns.</p>
            <Link href="/shop" className="relative btn-gold inline-block mt-6 px-8 py-3 text-sm font-medium">Explore the collection</Link>
          </div>
        </Reveal>
      </section>

      {/* NEW ARRIVALS — shown once designs are published */}
      {trending.length > 0 && (
      <section id="new-arrivals" className="max-w-7xl mx-auto px-5 py-8 scroll-mt-24">
        <h2 className="font-display text-4xl text-ink mb-7">New Arrivals</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {trending.map((p, i) => (
            <Reveal key={p.sku} delay={(i % 4) * 80}><ProductCard p={p as any} formula={formula} index={i} /></Reveal>
          ))}
        </div>
      </section>
      )}

      <ReelsSection reels={reels} />

      {/* REVIEWS — shown once there are verified reviews */}
      {reviews.length > 0 && (
      <section className="bg-emerald-mist/60 py-16 mt-12">
        <div className="max-w-7xl mx-auto px-5">
          <Reveal>
            <div className="text-center mb-9">
              <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Real words, real customers</p>
              <h2 className="font-display text-4xl text-ink mt-1">Happy Divas</h2>
            </div>
          </Reveal>
          <div className="grid md:grid-cols-3 gap-5">
            {reviews.map((r, i) => (
              <Reveal key={r.id} delay={i * 90}>
                <div className="bg-white rounded-2xl p-6 shadow-card h-full">
                  <Stars rating={r.rating} size="md" />
                  <p className="text-ink/80 mt-3 leading-relaxed">“{r.body}”</p>
                  <p className="text-sm font-medium text-ink mt-4">{r.author_name} <span className="text-muted font-normal">· verified buyer</span></p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
      )}
    </>
  );
}
