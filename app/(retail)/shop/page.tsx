// Rendered per request (NOT prerendered at build): the shop-home loader intentionally throws if the
// storefront read is momentarily empty (so it never caches a blank shop), and at build time that read has
// no data — which would fail the build. Speed still comes from the slim catalogue query + the inner
// loadShopHome cache (15 min, busted instantly by the "storefront" tag on any edit).
export const dynamic = "force-dynamic";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { getStorefront, getFeaturedReviews, getShoppableReels, getActivePromotions, getCategoryTree, getPricingFormula } from "@/lib/supabase/queries";
import { ProductCard } from "@/components/site/ProductCard";
import { PromoHero } from "@/components/site/PromoHero";
import { ProductImage } from "@/components/Placeholder";
import { TrustBar } from "@/components/site/TrustBar";
import { Reveal } from "@/components/site/Reveal";
import { Stars } from "@/components/site/Stars";
import { ReelsSection } from "@/components/site/ReelsSection";

export const metadata = {
  title: "Premium Artificial Jewellery — Kundan, Meena, Temple",
  description: "Shop handcrafted artificial jewellery from Blythe Diva. Necklaces, earrings, bracelets, anklets & rings with COD and ₹80 flat shipping across India.",
};

// The homepage shows the same catalogue to everyone, yet it was re-running 5 heavy queries
// (all published products via getStorefront, reviews, reels, promos, category tree) on EVERY render —
// so each soft navigation / prefetch to /shop took ~9s. Cache the whole bundle for 3 minutes so the
// page renders instantly; editing a product refreshes it within the window (or via the "storefront" tag).
const loadShopHome = unstable_cache(
  async () => {
    const [store, reviews, reels, promos, tree] = await Promise.all([
      getStorefront({ onlyInStock: true }), getFeaturedReviews(), getShoppableReels(), getActivePromotions("retail"), getCategoryTree(),
    ]);
    // Never cache an empty storefront: zero products means the read failed (DB restricted / transient),
    // so throwing keeps the empty result OUT of the cache and the page self-heals on the next request
    // once the database is reachable — instead of a one-off failure freezing the shop blank for 15 min.
    if (!store.products || store.products.length === 0) throw new Error("shop home: storefront read returned no products — not caching");
    return { products: store.products, formula: store.formula, reviews, reels, promos, tree };
  },
  ["shop-home-v3-instock"],
  { revalidate: 900, tags: ["storefront"] },
);

// loadShopHome THROWS on an empty read (so it never caches a blank shop). That's right for runtime, but it
// must NOT propagate — a transient empty read (or the build environment, which has no data) would 500 the
// page / fail the build. Catch it and render a minimal shell (category tiles still show; rails are empty
// this once) so the shop always renders and self-heals on the next request.
async function loadShopHomeSafe() {
  try {
    return await loadShopHome();
  } catch {
    const [formula, tree] = await Promise.all([getPricingFormula(), getCategoryTree()]);
    return { products: [] as any[], formula, reviews: [] as any[], reels: [] as any[], promos: [] as any[], tree };
  }
}

export default async function Shop() {
  const { products, formula, reviews, reels, promos, tree } = await loadShopHomeSafe();
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
  // Real product photos for the hero (falls back to curated premium images if the catalogue is empty).
  const heroPics = products.filter((p) => p.image).slice(0, 4);
  const HERO_FALLBACK = "https://imagedelivery.net/mqSJbpqjeuYhRGHhGSzOzw/01e7b55d-7167-4518-e6d7-5ad7c94cdc00/public";
  const HERO_FALLBACK_2 = "https://imagedelivery.net/mqSJbpqjeuYhRGHhGSzOzw/01b2af73-4eff-42f3-3650-96b997896c00/public";
  const HERO_FALLBACK_3 = "https://imagedelivery.net/mqSJbpqjeuYhRGHhGSzOzw/019c6ba4-8c92-4a46-528e-fb1cbf64d600/public";
  const HERO_FALLBACK_4 = "https://imagedelivery.net/mqSJbpqjeuYhRGHhGSzOzw/00c4637a-4e11-40d4-17fb-437578d9ca00/public";
  const heroMain = heroPics[0]?.image || HERO_FALLBACK;
  const heroSide = heroPics[1]?.image || HERO_FALLBACK_2;
  const heroSide2 = heroPics[2]?.image || HERO_FALLBACK_3;
  const heroSide3 = heroPics[3]?.image || HERO_FALLBACK_4;

  return (
    <>
      {/* AI promotional poster (festive offers) — auto-placed when the owner publishes a campaign. */}
      <PromoHero promos={promos} />

      {/* HERO — premium brand banner: big real product image + Blythe Diva branding + tagline */}
      <section className="relative overflow-hidden bg-gradient-to-b from-cream via-ivory to-ivory">
        <div className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full bg-gold/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-emerald/10 blur-3xl" />
        <div className="max-w-7xl mx-auto px-5 py-10 md:py-20 grid md:grid-cols-2 gap-8 md:gap-14 items-center relative">
          <div className="animate-fadeUp text-center md:text-left">
            <span className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] tracking-[0.25em] uppercase text-gold-dark bg-white/70 border border-gold/25 rounded-full px-3.5 py-1.5 mb-4 md:mb-5 shadow-sm">✦ Fine Artificial Jewellery</span>
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl leading-[1.02] text-ink">
              Blythe <span className="text-gold-gradient">Diva</span>
            </h1>
            <p className="font-display text-xl sm:text-2xl md:text-3xl text-ink/80 mt-2">Adorn your every moment.</p>

            {/* MOBILE hero image — shown right after the tagline so imagery is above the fold on phones */}
            <div className="md:hidden relative mt-6 mb-2 max-w-[19rem] mx-auto">
              <div className="relative rounded-[1.75rem] p-1.5 bg-gradient-to-br from-gold via-gold-light to-gold-dark shadow-luxe">
                <div className="relative rounded-[1.4rem] overflow-hidden bg-cream aspect-[4/5]">
  {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroMain} alt="Blythe Diva signature jewellery" loading="eager" decoding="async" className="h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink/70 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-4 text-left text-cream">
                    <p className="font-display text-xl tracking-tight">Blythe Diva</p>
                    <p className="text-[10px] tracking-[0.3em] uppercase text-cream/80">Signature Collection</p>
                  </div>
                </div>
              </div>
              <div className="absolute -left-3 -bottom-4 w-20 h-24 rounded-xl overflow-hidden shadow-luxe ring-4 ring-white rotate-[-6deg] animate-float">
                <img src={heroSide} alt="Blythe Diva jewellery" className="h-full w-full object-cover" />
              </div>
              <div className="absolute -right-2 top-3 bg-white rounded-xl shadow-luxe px-3 py-2 text-center animate-float" style={{ animationDelay: "1s" }}>
                <p className="text-gold text-xs leading-none">★★★★★</p>
                <p className="text-[10px] text-muted mt-0.5 font-medium">Loved by 10,000+</p>
              </div>
            </div>

            <p className="text-muted mt-5 max-w-md mx-auto md:mx-0 leading-relaxed">
              Handcrafted Kundan, Meenakari &amp; Temple jewellery — premium anti-tarnish finish and trend-ready designs, straight from Sadar Bazar, Delhi.
            </p>
            <div className="flex flex-wrap justify-center md:justify-start gap-3 mt-7">
              <Link href="#bestsellers" className="btn-primary px-7 py-3 text-sm font-medium">Shop the collection</Link>
              <Link href="#new-arrivals" className="px-7 py-3 text-sm font-medium rounded-full border border-ink/15 text-ink hover:border-gold hover:text-gold-dark transition-colors">New arrivals</Link>
            </div>
            <div className="flex flex-wrap justify-center md:justify-start items-center gap-x-4 gap-y-1.5 mt-8 text-sm text-muted">
              <span className="flex items-center gap-1.5"><span className="text-gold">★</span> 4.9 · 10,000+ happy divas</span>
              <span className="text-sand hidden sm:inline">·</span>
              <span>Cash on delivery</span>
              <span className="text-sand hidden sm:inline">·</span>
              <span>₹80 flat shipping</span>
            </div>
          </div>

          {/* DESKTOP hero cluster — the wide floating collage (hidden on phones) */}
          <div className="relative animate-fadeUp hidden md:block" style={{ animationDelay: "0.15s" }}>
            {/* Large framed brand image with a gold gradient ring */}
            <div className="relative mx-auto max-w-md lg:max-w-lg rounded-[2rem] p-2 bg-gradient-to-br from-gold via-gold-light to-gold-dark shadow-luxe">
              <div className="relative rounded-[1.7rem] overflow-hidden bg-cream aspect-[4/5]">
{/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroMain} alt="Blythe Diva signature jewellery" loading="eager" decoding="async" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-ink/70 to-transparent" />
                <div className="absolute inset-x-0 bottom-0 p-5 text-cream">
                  <p className="font-display text-2xl tracking-tight">Blythe Diva</p>
                  <p className="text-[11px] tracking-[0.3em] uppercase text-cream/80">Signature Collection</p>
                </div>
              </div>
            </div>
            {/* Floating product photos around the main image — variable sizes, spread wide to fill the hero */}
            <div className="absolute -left-16 lg:-left-24 bottom-0 w-36 h-48 lg:w-44 lg:h-60 rounded-2xl overflow-hidden shadow-luxe ring-4 ring-white rotate-[-6deg] animate-float z-10">
              <img src={heroSide} alt="Blythe Diva jewellery" className="h-full w-full object-cover" />
            </div>
            <div className="absolute -left-28 lg:-left-36 top-6 w-32 h-32 lg:w-36 lg:h-36 rounded-2xl overflow-hidden shadow-luxe ring-4 ring-white rotate-[5deg] animate-float z-10" style={{ animationDelay: "1.6s" }}>
              <img src={heroSide2} alt="Blythe Diva jewellery" className="h-full w-full object-cover" />
            </div>
            <div className="absolute -right-14 lg:-right-20 -bottom-8 w-40 h-32 lg:w-52 lg:h-40 rounded-2xl overflow-hidden shadow-luxe ring-4 ring-white rotate-[7deg] animate-float z-10" style={{ animationDelay: "0.8s" }}>
              <img src={heroSide3} alt="Blythe Diva jewellery" className="h-full w-full object-cover" />
            </div>
            {/* Floating rating chip */}
            <div className="absolute -right-2 lg:-right-6 top-4 bg-white rounded-2xl shadow-luxe px-4 py-2.5 text-center animate-float z-20" style={{ animationDelay: "1s" }}>
              <p className="text-gold text-sm leading-none">★★★★★</p>
              <p className="text-[11px] text-muted mt-1 font-medium">Loved by 10,000+</p>
            </div>
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
        {/* Circular category browse — round photo icons in a centred, wrapping row (the look the owner
            liked on theshoppingtree). Each links to its category; images come from the category tree. */}
        <div className="flex flex-wrap justify-center gap-x-5 gap-y-7 sm:gap-x-9">
          {cats.map((c, i) => (
            <Reveal key={c.slug} delay={i * 60}>
              <Link href={`/shop/c/${c.slug}`} className="group flex flex-col items-center gap-3.5 w-28 sm:w-36">
                <div className="h-28 w-28 sm:h-36 sm:w-36 rounded-full p-1.5 bg-gradient-to-br from-gold via-gold-light to-gold-dark shadow-luxe group-hover:shadow-xl transition-all duration-300 group-hover:-translate-y-1.5">
                  <div className="h-full w-full rounded-full overflow-hidden bg-cream ring-4 ring-white">
                    {c.image
                      ? <img src={c.image} alt={c.name} loading="lazy" decoding="async" className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
                      : <div className="card-img h-full w-full"><ProductImage name={c.name} /></div>}
                  </div>
                </div>
                <p className="text-center text-sm sm:text-base font-medium text-ink group-hover:text-emerald transition-colors leading-tight">{c.name}</p>
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
            <p className="relative text-cream/70 mt-3">₹80 flat shipping · Cash on delivery · Easy 7-day returns.</p>
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

      {/* REVIEWS — a proper branded, verified reviews wall (shown once there are reviews) */}
      {reviews.length > 0 && (() => {
        const avg = (reviews.reduce((s, r) => s + (r.rating || 0), 0) / reviews.length);
        return (
      <section className="relative bg-gradient-to-b from-cream via-ivory to-cream py-16 mt-12 border-y border-sand/60">
        <div className="max-w-7xl mx-auto px-5">
          <Reveal>
            <div className="text-center mb-10">
              <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Real words, real customers</p>
              <h2 className="font-display text-4xl md:text-5xl text-ink mt-1">Happy Divas</h2>
              {/* Aggregate rating trust bar */}
              <div className="mt-4 inline-flex items-center gap-3 bg-white rounded-full shadow-card border border-sand/60 px-5 py-2.5">
                <Stars rating={Math.round(avg)} size="md" />
                <span className="text-sm font-semibold text-ink">{avg.toFixed(1)} out of 5</span>
                <span className="hidden sm:inline text-sand">|</span>
                <span className="hidden sm:inline text-sm text-muted">Based on 10,000+ verified reviews</span>
              </div>
            </div>
          </Reveal>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {reviews.map((r, i) => (
              <Reveal key={r.id} delay={i * 90}>
                <div className="group bg-white rounded-2xl overflow-hidden shadow-card hover:shadow-luxe hover:-translate-y-1 transition-all duration-300 h-full flex flex-col border border-sand/50">
                  {r.image_url && (
                    <div className="relative aspect-[4/3] overflow-hidden bg-cream">
                      <img src={r.image_url} alt={`Review by ${r.author_name}`} loading="lazy" className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      <span className="absolute top-3 left-3 inline-flex items-center gap-1 bg-white/95 backdrop-blur text-[11px] font-semibold text-emerald rounded-full px-2.5 py-1 shadow-sm">
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                        Verified Purchase
                      </span>
                    </div>
                  )}
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex items-center justify-between">
                      <Stars rating={r.rating} size="md" />
                      <span className="text-gold/30 font-display text-3xl leading-none">&rdquo;</span>
                    </div>
                    <p className="text-ink/80 mt-3 leading-relaxed flex-1">{r.body}</p>
                    <div className="flex items-center gap-3 mt-5 pt-4 border-t border-sand/50">
                      <span className="grid place-items-center h-9 w-9 rounded-full bg-gold/15 text-gold-dark font-semibold text-sm">{r.author_name.charAt(0)}</span>
                      <div className="leading-tight">
                        <p className="text-sm font-semibold text-ink">{r.author_name}</p>
                        <p className="text-[11px] text-emerald font-medium">✓ Verified buyer</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>
        );
      })()}
    </>
  );
}
