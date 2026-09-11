// ISR: each product page is edge-cached and refreshed in the background, so repeat views load instantly
// instead of re-rendering on the server every time. Its data is already wrapped in unstable_cache below,
// and edits/stock changes bust it immediately via the "storefront" tag.
export const revalidate = 300;
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySku, getPricingFormula, getProductReviews, getRecommendations, isStorefrontImage } from "@/lib/supabase/queries";
import { resolveProductContent } from "@/lib/content";
import { liveOffer } from "@/lib/offers";
import { formatPaise, resolvePrices, overridesOf } from "@/lib/pricing";
import { Gallery } from "@/components/site/Gallery";
import { BuyBox } from "@/components/site/BuyBox";
import { VariantImageProvider } from "@/components/site/VariantImageSync";
import { Stars } from "@/components/site/Stars";
import { Back } from "@/components/site/Back";
import { Reveal } from "@/components/site/Reveal";
import { ProductCard } from "@/components/site/ProductCard";

// Next.js type-checks a page's props and allows ONLY params/searchParams, so `preview` cannot be
// declared here. It is read off the props object at runtime instead — see ProductPage below.
type Params = { params: { category: string; sku: string } };

// Cache the product page's data per-SKU (3 min). getRecommendations scans the catalogue, so rendering
// this uncached re-ran heavy queries on every product view. Edits refresh within the window / "storefront" tag.
/**
 * Sept 2026 — "preview not working", and product pages taking ~9-11s on a first view.
 *
 * MEASURED on the live site: an uncached product page took 8.9s-11.1s; the same page warm took
 * 0.6s. The whole difference is the "you may also like" rail. getRecommendations calls
 * getStorefrontCached(), which reads the ENTIRE published catalogue — every product, every
 * product_image and every variant, paged 1000 rows at a time — and then re-parses that whole blob,
 * all to choose FOUR cards. The owner's View ↗ button renders this same page through
 * /admin/preview/<sku>, which is force-dynamic and behind auth, so it pays that cost on a real
 * request and trips the host's 10s function limit — the "Couldn't load that page" he sees.
 *
 * Two things were wrong, and they are fixed separately below.
 *
 * 1. THE RAIL WAS INSIDE THE PAGE'S CACHE ENTRY, AND IN generateMetadata'S PATH.
 *    unstable_cache keys on the arguments, so loadProductPage(sku) from generateMetadata and
 *    loadProductPage(sku, false) from the page body were TWO different entries — one cold customer
 *    visit ran the whole heavy load twice. The core load is now a single-argument function with no
 *    recommendations in it at all, so metadata and the page body share one entry, and metadata —
 *    which only ever needed the title and description — no longer drags the catalogue in behind it.
 *
 * 2. THE RAIL COULD TAKE THE PAGE DOWN WITH IT.
 *    It is decorative. It must never be the reason a product page or a preview fails, so it is
 *    fetched separately, under its own cache key, behind a time budget (see RELATED_BUDGET_MS).
 */
const loadProductPage = unstable_cache(
  async (sku: string) => {
    const [p, formula] = await Promise.all([getProductBySku(sku), getPricingFormula()]);
    if (!p) return null;
    // Reviews are secondary — a failure there must NEVER take down the whole product page.
    const reviews = await getProductReviews(p.id).catch(() => ({ avg: 4.6, count: 0, list: [] as any[], dist: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } as Record<number, number> }));
    return { p, formula, reviews };
  },
  ["shop-product-core-v2"],
  { revalidate: 180, tags: ["storefront"] },
);

/** The "you may also like" rail, cached on its own so a slow or empty rail never sits inside — or
 *  invalidates — the product's own cached data. */
const loadRelated = unstable_cache(
  async (sku: string, n: number) => getRecommendations(sku, n).catch(() => [] as any[]),
  ["shop-product-related-v1"],
  { revalidate: 180, tags: ["storefront"] },
);

/** How long the page will wait for the related rail before rendering without it.
 *  A cold catalogue read measured 8.9-11.1s and the host kills the request at 10s, so waiting is
 *  not an option: better a product page with no rail than no product page. Only the WAIT is
 *  abandoned — the real result still lands in loadRelated's cache, so nothing caches an empty rail.
 *
 *  Be honest about what this does and does not fix: it guarantees the page renders, it does not
 *  make the rail fast. While the shared catalogue cache is cold the rail will simply be absent.
 *  The real fix is for getRecommendations to stop reading 4,500 products to choose four — it should
 *  query the same subcategory/category directly — and that is a separate change to
 *  lib/supabase/queries.ts, deliberately not bundled into this one. */
const RELATED_BUDGET_MS = 2_500;

function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  // Reuse the cached per-SKU load (was an extra uncached read that also forced the page to render
  // dynamically on every visit).
  const p = (await loadProductPage(params.sku))?.p;
  if (!p) return { title: "Product not found" };
  const c = resolveProductContent({ name: p.name, sku: p.sku, categoryName: p.category?.name, subcategoryName: (p as any).subcategory?.name, polishes: p.variants?.map((v) => v.polish ?? "").filter(Boolean), colors: p.variants?.map((v) => v.color ?? "").filter(Boolean), generated_content: p.generated_content });
  return { title: c.seo.metaTitle, description: c.seo.metaDescription, keywords: c.seo.keywords, openGraph: { title: c.seo.metaTitle, description: c.seo.metaDescription } };
}

export default async function ProductPage(props: Params) {
  const { params } = props;
  // Set ONLY by the admin preview route (app/(admin)/admin/preview/[sku]/page.tsx), which checks
  // the staff session first and passes it in code. Next.js never puts `preview` on a page's props,
  // so a customer typing this URL can never turn it on.
  const preview = (props as { preview?: boolean }).preview === true;
  const data = await loadProductPage(params.sku);
  if (!data) notFound();
  const { p, formula, reviews } = data;
  // The related rail: skipped entirely for the staff preview (previewing is about checking ONE
  // design's own page), and time-budgeted for customers so it can never hold the page past the
  // host's request limit. See RELATED_BUDGET_MS above.
  const related = preview ? ([] as any[]) : await withBudget(loadRelated(p.sku, 4), RELATED_BUDGET_MS, [] as any[]);
  const variants = (p.variants ?? []) as any[];
  const availableQty = variants.length
    ? variants.reduce((total, variant) => total + Math.max(0, variant.qty ?? 0), 0)
    : Math.max(0, (p as any).qty ?? 0);
  const publiclyVisible = (p as any).status === "published" && availableQty > 0;
  // Direct public URLs must not reveal unpublished or unavailable products.
  //
  // `preview` is set ONLY by the admin-side /admin/preview/<sku> route, which checks the staff
  // session before rendering. Next.js never passes it, so a customer hitting this URL always gets
  // the 404 above. Without this the owner's "View ↗" button in the catalogue 404'd on every draft
  // and every sold-out design — the two cases he most needs to look at.
  if (!preview && !publiclyVisible) notFound();

  // Category should always be present (FK), but never let a missing relation 500 the page.
  const catSlug = p.category?.slug ?? "all";
  const catName = p.category?.name ?? "Jewellery";

  const colors = (p.variants ?? []).map((v) => v.color ?? "").filter(Boolean);
  const content = resolveProductContent({ name: p.name, sku: p.sku, categoryName: p.category?.name, subcategoryName: (p as any).subcategory?.name, polishes: p.variants?.map((v) => v.polish ?? "").filter(Boolean), colors, generated_content: p.generated_content });
  const pOv = overridesOf(p);
  const o = liveOffer(p.base_wholesale, formula, pOv);
  // Owner-chosen DEFAULT VARIANT leads (pre-selected colour + its photo fronts the gallery) — BUT if
  // that default colour is out of stock, the FIRST in-stock colour leads instead, so a customer never
  // opens on a sold-out colour. If a product has just one colour in stock, it becomes the lead
  // automatically. Falls back to the marked default / natural order otherwise.
  const defVid = (p as any).default_variant_id ?? null;
  const allVars = [...(p.variants ?? [])] as any[];
  const def = defVid ? allVars.find((v) => v.id === defVid) : null;
  const leadId = (def && (def.qty ?? 0) > 0) ? def.id
    : (allVars.find((v) => (v.qty ?? 0) > 0)?.id ?? defVid ?? allVars[0]?.id ?? null);
  const orderedVariants = leadId
    ? allVars.sort((a, b) => (a.id === leadId ? -1 : b.id === leadId ? 1 : 0))
    : allVars;
  // "Hide out-of-stock colours" — products.hide_oos_variants, the toggle on the Catalogue tab.
  //
  // Sept 2026: that toggle was stored and shown in the console but NOTHING ever read it — this line
  // filtered sold-out colours unconditionally, so the switch did nothing either way and its "shown
  // to customers as Out of stock" wording was simply untrue. It is wired up here.
  //
  // It DEFAULTS TO ON (owner's request), and "on" is exactly what this page already did, so no
  // existing design changes behaviour — only an explicit OFF now shows sold-out colours. BuyBox
  // already handles those correctly: its `outOfStock` state disables Add to cart for the selected
  // colour. A design with EVERY colour sold out still 404s for customers via the check above, so
  // turning this off can never put an unbuyable page in front of a shopper.
  const hideOosColours = (p as any).hide_oos_variants !== false;
  const visibleVariants = hideOosColours
    ? (orderedVariants as any[]).filter((v: any) => (v.qty ?? 0) > 0)
    : (orderedVariants as any[]);
  // Per-variant: its own photo, stock and price (variant override → product override → formula).
  const variantsForBuy = (visibleVariants as any[]).map((v: any) => {
    const vOv = overridesOf(v);
    const merged = { wholesale: vOv.wholesale ?? pOv.wholesale, retail: vOv.retail ?? pOv.retail, mrp: vOv.mrp ?? pOv.mrp };
    const vo = liveOffer(p.base_wholesale, formula, merged);
    const label = [v.color, v.size, v.polish].filter(Boolean).join(" · ") || v.sku;
    // `value` is the raw colour the order matches on (place_order matches the colour column); `label` is
    // only for display. Keeping them separate stops a composite label ("Gold · Gold") from breaking checkout.
    return { sku: v.sku, label, value: v.color ?? null, image: (v.image_paths?.[0] ?? null) as string | null, price: vo.price, qty: v.qty ?? 0 };
  });
  // Gallery shows AI-generated product photos + every visible variant photo, all zoomable. The raw
  // upload (kind 'source'/'flatlay') is kept for the Fix-a-detail editor but never shown to customers.
  const galleryImages = [
    ...((p.images ?? []) as any[]).filter((i: any) => isStorefrontImage(i.kind)),
    ...((visibleVariants ?? []) as any[]).flatMap((v: any) => (((v.image_paths ?? []) as string[]) || []).map((path) => ({ path, kind: v.color }))),
  ];
  // Owner-chosen storefront cover leads the gallery (so the hero matches the card thumbnail).
  const coverPath = typeof (p as any).thumbnail_path === "string" && (p as any).thumbnail_path.startsWith("http") ? (p as any).thumbnail_path : null;
  if (coverPath) {
    const i = galleryImages.findIndex((g: any) => g.path === coverPath);
    if (i > 0) galleryImages.unshift(galleryImages.splice(i, 1)[0]);
    // If the cover is no longer one of the product's images (i === -1) it was deleted — do NOT force
    // it back in, otherwise a removed photo keeps reappearing as the hero ("deleted everywhere but
    // the cover still shows"). It simply falls back to the first real image.
  }
  const waText = `Please place an order for ${p.name} (SKU:${p.sku})`;
  const waHref = `https://wa.me/918700091298?text=${encodeURIComponent(waText)}`;
  

  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product", name: p.name, sku: p.sku, category: catName,
    description: content.seo.metaDescription, keywords: content.seo.keywords.join(", "), brand: { "@type": "Brand", name: "Blythe Diva" },
    // Only advertise a rating when real reviews exist — a fake aggregateRating is a Google penalty risk.
    ...(reviews.count > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: reviews.avg, reviewCount: reviews.count } } : {}),
    offers: { "@type": "Offer", priceCurrency: "INR", price: (o.price / 100).toFixed(2), availability: p.qty > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };

  return (
    <div className="max-w-6xl mx-auto px-5 py-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      {preview && !publiclyVisible && (
        // Staff-only preview of a page customers cannot reach yet. Says exactly WHY it is hidden,
        // so the owner can see the design and know what to change to make it live.
        <div className="mb-5 rounded-xl border border-gold/50 bg-gold/10 px-4 py-3">
          <p className="text-sm font-medium text-ink">Preview — customers cannot see this page yet.</p>
          <p className="text-xs text-muted mt-0.5">
            {(p as any).status !== "published"
              ? `This design is a ${(p as any).status || "draft"}. Publish it to put this page on the store.`
              : "Every colour is out of stock. Add stock to put this page back on the store."}
          </p>
        </div>
      )}
      <div className="flex items-center justify-between gap-4 mb-5">
        <Back label="Back" />
        <nav className="text-xs text-muted">
          <Link href="/shop" className="hover:text-emerald">Home</Link> /{" "}
          <Link href={`/shop/c/${catSlug}`} className="hover:text-emerald">{catName}</Link> / <span className="text-ink">{p.sku}</span>
        </nav>
      </div>

      <VariantImageProvider>
      <div className="grid md:grid-cols-2 gap-10">
        <div className="animate-fadeIn md:sticky md:top-24 self-start"><Gallery name={p.name} images={galleryImages} /></div>

        <div className="md:py-2">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gold-dark">{catName} · {p.sku}</p>
          <h1 className="font-display text-4xl text-ink mt-1 leading-snug break-words">{content.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Stars rating={reviews.avg} count={reviews.count} size="md" />
            <a href="#reviews" className="text-xs text-emerald nav-link">Read reviews</a>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-3xl font-semibold text-ink leading-none">{formatPaise(o.price)}</span>
            {o.hasOffer && <span className="text-lg text-muted line-through leading-none">{formatPaise(o.mrp)}</span>}
            {o.hasOffer && <span className="text-sm font-semibold text-white bg-rose px-2 py-0.5 rounded-full leading-none">{o.offerPct}% OFF</span>}
          </div>
          <p className="text-xs text-muted mt-1">Inclusive of all taxes · You save {formatPaise(o.savings)}</p>

          <BuyBox variants={variantsForBuy} waText={waText} waHref={waHref} item={{ sku: p.sku, name: p.name, price: o.price, category: catSlug, qty: (p as any).qty }} />

          <div className="mt-7 border-t border-sand pt-5 space-y-2 text-ink/80 leading-relaxed">
            {content.description.split("\n").map((line) => line.trim()).filter(Boolean).map((line, i) => {
              const m = line.match(/^([A-Z][A-Z &]+):\s*(.*)$/);
              return m
                ? <p key={i} className="text-sm"><span className="font-semibold text-ink">{m[1]}:</span> {m[2]}</p>
                : <p key={i}>{line}</p>;
            })}
          </div>

          {content.specs && Object.keys(content.specs).length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-ink mb-2">Specifications</h3>
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              {Object.entries(content.specs).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="text-ink/90">{v}</dd></div>
              ))}
            </dl>
          </div>
          )}

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
        </div>
      </div>
      </VariantImageProvider>

      {/* REVIEWS */}
      <section id="reviews" className="mt-16 grid md:grid-cols-3 gap-8">
        <div className="md:col-span-1">
          <h2 className="font-display text-3xl text-ink">Customer Reviews</h2>
          {reviews.count > 0 ? (
            <div className="mt-3 flex items-end gap-3">
              <span className="text-5xl font-semibold text-ink">{reviews.avg}</span>
              <div className="pb-1"><Stars rating={reviews.avg} count={reviews.count} /><p className="text-xs text-muted mt-1">{reviews.count} verified review{reviews.count === 1 ? "" : "s"}</p></div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No reviews yet — be the first to review this piece.</p>
          )}
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
