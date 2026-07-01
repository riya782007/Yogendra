export const dynamic = "force-dynamic";
import Link from "next/link";
import { getStorefront, getFeaturedReviews, getShoppableReels } from "@/lib/supabase/queries";
import { ProductCard } from "@/components/site/ProductCard";
import { ProductImage } from "@/components/Placeholder";
import { TrustBar } from "@/components/site/TrustBar";
import { Reveal } from "@/components/site/Reveal";
import { Stars } from "@/components/site/Stars";
import { ReelsSection } from "@/components/site/ReelsSection";

export const metadata = {
  title: "Premium Artificial Jewellery — Kundan, Meena, Temple",
  description: "Shop handcrafted artificial jewellery from Blythe Diva, Sadar Bazar Delhi. Necklaces, earrings, bracelets, anklets & rings with COD and free shipping over ₹999.",
};

export default async function Shop() {
  const [{ products, formula }, reviews, reels] = await Promise.all([getStorefront(), getFeaturedReviews(), getShoppableReels()]);
  const cats = Array.from(new Map(products.map((p) => [p.category.slug, p.category])).values());
  const bestsellers = [...products].sort((a, b) => b.reviews - a.reviews).slice(0, 8);
  const trending = products.slice(0, 8);

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-b from-cream to-ivory">
        <div className="max-w-7xl mx-auto px-5 py-14 md:py-20 grid md:grid-cols-2 gap-10 items-center">
          <div className="animate-fadeUp">
            <p className="text-gold-dark tracking-[0.3em] uppercase text-xs mb-4">Yogendra Industries · Since Sadar Bazar</p>
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
              <span>★ 4.8 avg rating</span><span>·</span><span>50,000+ customers</span><span>·</span><span>24 designs live</span>
            </div>
          </div>
          <div className="relative h-[360px] md:h-[440px]">
            <div className="absolute right-0 top-0 w-52 h-64 rounded-3xl overflow-hidden shadow-luxe rotate-3 animate-float"><ProductImage name="Kundan Set" /></div>
            <div className="absolute left-2 top-16 w-44 h-56 rounded-3xl overflow-hidden shadow-luxe -rotate-6 animate-float" style={{ animationDelay: "1s" }}><ProductImage name="Meena Haar" /></div>
            <div className="absolute left-28 bottom-0 w-40 h-48 rounded-3xl overflow-hidden shadow-gold rotate-2 animate-float" style={{ animationDelay: "2s" }}><ProductImage name="Jhumka" /></div>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {cats.map((c, i) => (
            <Reveal key={c.slug} delay={i * 70}>
              <Link href={`/shop/c/${c.slug}`} className="group block rounded-2xl overflow-hidden bg-white shadow-card hover:shadow-luxe transition-all hover:-translate-y-1">
                <div className="aspect-square overflow-hidden"><div className="card-img h-full w-full"><ProductImage name={c.name} /></div></div>
                <p className="text-center py-3 text-sm font-medium text-ink group-hover:text-emerald transition-colors">{c.name}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* BESTSELLERS */}
      <section id="bestsellers" className="max-w-7xl mx-auto px-5 py-8">
        <div className="flex items-end justify-between mb-7">
          <div>
            <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Loved by thousands</p>
            <h2 className="font-display text-4xl text-ink mt-1">Bestsellers</h2>
          </div>
          <Link href="/shop/c/necklace" className="nav-link text-sm text-emerald">View all →</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {bestsellers.map((p, i) => (
            <Reveal key={p.sku} delay={(i % 4) * 80}><ProductCard p={p as any} formula={formula} index={i} /></Reveal>
          ))}
        </div>
      </section>

      {/* FESTIVE BANNER */}
      <section className="max-w-7xl mx-auto px-5 py-12">
        <Reveal>
          <div className="rounded-3xl bg-ink text-cream px-8 py-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(circle at 20% 20%, #C8A24C, transparent 40%), radial-gradient(circle at 80% 80%, #0F5C4D, transparent 40%)" }} />
            <p className="relative text-gold-light tracking-[0.3em] uppercase text-xs">Festive Edit</p>
            <h2 className="relative font-display text-4xl md:text-5xl mt-2">Flat 20% off, sitewide</h2>
            <p className="relative text-cream/70 mt-3">No code needed. Free shipping over ₹999. Cash on delivery available.</p>
            <Link href="#bestsellers" className="relative btn-gold inline-block mt-6 px-8 py-3 text-sm font-medium">Shop now</Link>
          </div>
        </Reveal>
      </section>

      {/* TRENDING */}
      <section className="max-w-7xl mx-auto px-5 py-8">
        <h2 className="font-display text-4xl text-ink mb-7">New &amp; Trending</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {trending.map((p, i) => (
            <Reveal key={p.sku} delay={(i % 4) * 80}><ProductCard p={p as any} formula={formula} index={i} /></Reveal>
          ))}
        </div>
      </section>

      <ReelsSection reels={reels} />

      {/* REVIEWS */}
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
    </>
  );
}
