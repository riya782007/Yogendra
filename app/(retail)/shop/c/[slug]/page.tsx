export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorefront, getCategories } from "@/lib/supabase/queries";
import { ProductCard } from "@/components/site/ProductCard";
import { Reveal } from "@/components/site/Reveal";
import { Back } from "@/components/site/Back";
import { liveOffer } from "@/lib/offers";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const name = params.slug.charAt(0).toUpperCase() + params.slug.slice(1);
  return {
    title: `${name} — Artificial Jewellery`,
    description: `Shop ${name.toLowerCase()} from Blythe Diva, Sadar Bazar Delhi. Premium artificial ${name.toLowerCase()} at retail & wholesale, with COD and free shipping over ₹999.`,
    keywords: [name, "artificial jewellery", "Sadar Bazar", "Delhi", "wholesale"],
  };
}

type SP = { sort?: string; min?: string; max?: string; stock?: string };

export default async function CategoryPage({ params, searchParams }: { params: { slug: string }; searchParams: SP }) {
  const [{ products, formula }, allCats] = await Promise.all([getStorefront(), getCategories()]);
  const cat = allCats.find((c) => c.slug === params.slug);
  let items = products.filter((p) => p.category.slug === params.slug);
  // Only 404 on a genuinely unknown slug. A real but empty category still opens
  // (it just shows an empty state) — so the storefront menu never dead-ends.
  if (!cat && items.length === 0) notFound();
  const catName = items[0]?.category.name ?? cat?.name ?? params.slug;
  const noneAtAll = items.length === 0;

  const min = searchParams.min ? Number(searchParams.min) * 100 : 0;
  const max = searchParams.max ? Number(searchParams.max) * 100 : Infinity;
  const inStockOnly = searchParams.stock === "1";
  items = items.filter((p) => {
    const price = liveOffer(p.base_wholesale, formula).price;
    return price >= min && price <= max && (!inStockOnly || p.qty > 0);
  });
  if (searchParams.sort === "price") items = [...items].sort((a, b) => a.base_wholesale - b.base_wholesale);
  else if (searchParams.sort === "price-desc") items = [...items].sort((a, b) => b.base_wholesale - a.base_wholesale);
  else if (searchParams.sort === "rating") items = [...items].sort((a, b) => b.rating - a.rating);

  const qs = (extra: Partial<SP>) => {
    const m = { ...searchParams, ...extra } as Record<string, string | undefined>;
    const p = new URLSearchParams();
    Object.entries(m).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
    return `/shop/c/${params.slug}?${p.toString()}`;
  };
  const inp = "rounded-lg border border-sand px-3 py-1.5 text-sm bg-white outline-none focus:border-emerald w-24";

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      <div className="flex items-center justify-between gap-4 mb-2">
        <Back label="Back" />
        <div className="text-xs text-muted"><Link href="/shop" className="hover:text-emerald">Home</Link> / <span className="text-ink">{catName}</span></div>
      </div>
      <Reveal>
        <header className="text-center my-8">
          <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Collection</p>
          <h1 className="font-display text-5xl text-ink mt-1">{catName}</h1>
          <p className="text-muted mt-2">{items.length} designs · live pricing &amp; stock</p>
        </header>
      </Reveal>

      <div className="bg-white rounded-2xl shadow-card p-4 mb-6 flex flex-wrap items-end gap-4">
        <form className="flex items-end gap-2" action={`/shop/c/${params.slug}`}>
          <input type="hidden" name="sort" value={searchParams.sort ?? ""} />
          <input type="hidden" name="stock" value={searchParams.stock ?? ""} />
          <label className="text-xs text-muted">Min ₹<input name="min" defaultValue={searchParams.min} inputMode="numeric" className={`${inp} block mt-1`} /></label>
          <label className="text-xs text-muted">Max ₹<input name="max" defaultValue={searchParams.max} inputMode="numeric" className={`${inp} block mt-1`} /></label>
          <button className="px-4 py-1.5 rounded-full bg-ink text-white text-sm">Apply</button>
        </form>
        <Link href={qs({ stock: inStockOnly ? undefined : "1" })}
          className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${inStockOnly ? "border-emerald bg-emerald-mist text-emerald" : "border-sand text-muted hover:border-emerald"}`}>In stock only</Link>
        <div className="flex items-center gap-1.5 ml-auto text-sm">
          <span className="text-muted">Sort:</span>
          {[["", "Featured"], ["price", "Price ↑"], ["price-desc", "Price ↓"], ["rating", "Top rated"]].map(([k, label]) => (
            <Link key={k} href={qs({ sort: k || undefined })}
              className={`px-2.5 py-1 rounded-full border transition-colors ${(searchParams.sort ?? "") === k ? "border-emerald text-emerald bg-emerald-mist" : "border-sand text-muted hover:border-emerald"}`}>{label}</Link>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        noneAtAll ? (
          <div className="text-center py-16">
            <p className="text-ink font-medium">New designs are on their way to this collection.</p>
            <p className="text-muted text-sm mt-1">Browse the <Link href="/shop" className="text-emerald nav-link">full collection</Link> in the meantime.</p>
          </div>
        ) : (
          <p className="text-center text-muted py-12">No designs match these filters. <Link href={`/shop/c/${params.slug}`} className="text-emerald nav-link">Clear filters</Link></p>
        )
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {items.map((p, i) => (<Reveal key={p.sku} delay={(i % 4) * 70}><ProductCard p={p as any} formula={formula} /></Reveal>))}
        </div>
      )}
    </div>
  );
}
