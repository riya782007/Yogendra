export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStorefront, getCategories } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { ProductCard } from "@/components/site/ProductCard";
import { Reveal } from "@/components/site/Reveal";
import { Back } from "@/components/site/Back";
import { liveOffer } from "@/lib/offers";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const name = params.slug.charAt(0).toUpperCase() + params.slug.slice(1);
  return {
    title: `${name} — Artificial Jewellery`,
    description: `Shop ${name.toLowerCase()} from Blythe Diva, Sadar Bazar Delhi. Premium artificial ${name.toLowerCase()} with COD and free shipping over ₹999.`,
    keywords: [name, "artificial jewellery", "Sadar Bazar", "Delhi"],
  };
}

type SP = { sort?: string; min?: string; max?: string; stock?: string; sub?: string; style?: string; color?: string; disc?: string; rating?: string; label?: string };

export default async function CategoryPage({ params, searchParams }: { params: { slug: string }; searchParams: SP }) {
  const sb = supabaseServer();
  const [{ products, formula }, allCats] = await Promise.all([getStorefront(), getCategories()]);
  const cat = allCats.find((c) => c.slug === params.slug);
  let items = products.filter((p) => p.category.slug === params.slug);
  if (!cat && items.length === 0) notFound();
  const catName = items[0]?.category.name ?? cat?.name ?? params.slug;
  const noneAtAll = items.length === 0;

  const catItems = items;                                   // before filters — for accurate chip counts
  const catProductIds = (catItems as any[]).map((p) => p.id);

  // ---- Filter dimensions, all wired from the catalogue/inventory data ----
  // Type (subcategory), Style, Colour (from variants), Quick filters (labels).
  const [subsRes, stylesRes, varsRes, labelsRes] = await Promise.all([
    cat ? sb.from("subcategories").select("id,name,slug,sort").eq("category_id", cat.id).order("sort").order("name") : Promise.resolve({ data: [] as any[] }),
    cat ? sb.from("styles").select("id,name,slug,sort").eq("category_id", cat.id).order("sort").order("name") : Promise.resolve({ data: [] as any[] }),
    catProductIds.length ? sb.from("variants").select("product_id,color").in("product_id", catProductIds) : Promise.resolve({ data: [] as any[] }),
    catProductIds.length ? sb.from("product_labels").select("product_id, labels(name)").in("product_id", catProductIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const subs = (subsRes.data as any[]) ?? [];
  const styles = (stylesRes.data as any[]) ?? [];

  // product → its subcategory ids (primary + many-to-many map)
  const prodSubs = new Map<string, Set<string>>();
  if (subs.length) {
    const { data: maps } = await sb.from("product_subcategory_map").select("product_id,subcategory_id").in("subcategory_id", subs.map((s) => s.id));
    for (const m of ((maps as any[]) ?? [])) { let set = prodSubs.get(m.product_id); if (!set) { set = new Set(); prodSubs.set(m.product_id, set); } set.add(m.subcategory_id); }
    for (const p of catItems as any[]) if (p.subcategory_id) { let set = prodSubs.get(p.id); if (!set) { set = new Set(); prodSubs.set(p.id, set); } set.add(p.subcategory_id); }
  }
  const inSub = (p: any, subId: string) => prodSubs.get(p.id)?.has(subId);
  const subBySlug = new Map(subs.map((s) => [s.slug, s.id]));
  const styleBySlug = new Map(styles.map((s) => [s.slug, s.id]));

  // product → colours (from variants); + the distinct colour list for chips
  const colourByProduct = new Map<string, Set<string>>();
  for (const v of ((varsRes.data as any[]) ?? [])) {
    const c = String(v.color ?? "").trim(); if (!c) continue;
    let set = colourByProduct.get(v.product_id); if (!set) { set = new Set(); colourByProduct.set(v.product_id, set); } set.add(c);
  }
  const colourCounts = new Map<string, number>();
  for (const [, set] of colourByProduct) for (const c of set) colourCounts.set(c, (colourCounts.get(c) ?? 0) + 1);
  const colours = [...colourCounts.keys()].sort();

  // product → labels (quick filters)
  const labelByProduct = new Map<string, Set<string>>();
  const labelSet = new Set<string>();
  for (const r of ((labelsRes.data as any[]) ?? [])) {
    const nm = (r as any).labels?.name; if (!nm) continue;
    let set = labelByProduct.get(r.product_id); if (!set) { set = new Set(); labelByProduct.set(r.product_id, set); } set.add(nm);
    labelSet.add(nm);
  }
  const labels = [...labelSet].sort();

  // ---- apply the active filters ----
  const activeSub = searchParams.sub && subBySlug.has(searchParams.sub) ? searchParams.sub : undefined;
  if (activeSub) { const sid = subBySlug.get(activeSub); items = items.filter((p) => inSub(p, sid)); }
  const activeStyle = searchParams.style && styleBySlug.has(searchParams.style) ? searchParams.style : undefined;
  if (activeStyle) { const stid = styleBySlug.get(activeStyle); items = items.filter((p: any) => p.style_id === stid); }
  const activeColor = searchParams.color && colourCounts.has(searchParams.color) ? searchParams.color : undefined;
  if (activeColor) items = items.filter((p: any) => colourByProduct.get(p.id)?.has(activeColor));
  const activeLabel = searchParams.label && labelSet.has(searchParams.label) ? searchParams.label : undefined;
  if (activeLabel) items = items.filter((p: any) => labelByProduct.get(p.id)?.has(activeLabel));

  const min = searchParams.min ? Number(searchParams.min) * 100 : 0;
  const max = searchParams.max ? Number(searchParams.max) * 100 : Infinity;
  const inStockOnly = searchParams.stock === "1";
  const minDisc = Number(searchParams.disc) || 0;
  const minRating = Number(searchParams.rating) || 0;
  items = items.filter((p) => {
    const o = liveOffer(p.base_wholesale, formula);
    return o.price >= min && o.price <= max
      && (!inStockOnly || p.qty > 0)
      && (minDisc <= 0 || o.offerPct >= minDisc)
      && (minRating <= 0 || (p.rating ?? 0) >= minRating);
  });
  if (searchParams.sort === "price") items = [...items].sort((a, b) => a.base_wholesale - b.base_wholesale);
  else if (searchParams.sort === "price-desc") items = [...items].sort((a, b) => b.base_wholesale - a.base_wholesale);
  else if (searchParams.sort === "rating") items = [...items].sort((a, b) => b.rating - a.rating);

  const qs = (extra: Partial<SP>) => {
    const m = { ...searchParams, ...extra } as Record<string, string | undefined>;
    const p = new URLSearchParams();
    Object.entries(m).forEach(([k, v]) => { if (v) p.set(k, String(v)); });
    const s = p.toString();
    return `/shop/c/${params.slug}${s ? `?${s}` : ""}`;
  };
  const inp = "rounded-lg border border-sand px-3 py-1.5 text-sm bg-white outline-none focus:border-emerald w-24";
  const chip = (active: boolean, tone: "type" | "style" | "color" | "quick" = "type") => {
    const on = { type: "border-emerald bg-emerald-mist text-emerald", style: "border-gold bg-gold/15 text-gold-dark", color: "border-ink bg-ink text-white", quick: "border-wine bg-wine/10 text-wine" }[tone];
    return `px-3.5 py-1.5 rounded-full text-sm border transition-colors ${active ? on : "border-sand text-muted hover:border-emerald"}`;
  };
  const anyFilter = !!(activeSub || activeStyle || activeColor || activeLabel || searchParams.min || searchParams.max || inStockOnly || minDisc || minRating || searchParams.sort);
  const Row = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted w-16 shrink-0">{label}</span>
      {children}
    </div>
  );

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

      {/* ================= FILTERS ================= */}
      <div className="bg-white rounded-2xl shadow-card p-4 sm:p-5 mb-6 space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-medium text-ink text-sm">Filters</p>
          {anyFilter && <Link href={`/shop/c/${params.slug}`} className="text-xs text-rose hover:underline">Clear all</Link>}
        </div>

        {/* Quick filters (labels) */}
        {labels.length > 0 && (
          <Row label="Quick">
            {labels.map((l) => <Link key={l} href={qs({ label: activeLabel === l ? undefined : l })} className={chip(activeLabel === l, "quick")}>{l}</Link>)}
          </Row>
        )}

        {/* Type (subcategory) */}
        {subs.length > 0 && (
          <Row label="Type">
            <Link href={qs({ sub: undefined })} className={chip(!activeSub, "type")}>All ({catItems.length})</Link>
            {subs.map((s) => { const n = (catItems as any[]).filter((p) => inSub(p, s.id)).length; if (n === 0) return null;
              return <Link key={s.id} href={qs({ sub: activeSub === s.slug ? undefined : s.slug })} className={chip(activeSub === s.slug, "type")}>{s.name} ({n})</Link>; })}
          </Row>
        )}

        {/* Style */}
        {styles.length > 0 && (
          <Row label="Style">
            {styles.map((s) => <Link key={s.id} href={qs({ style: activeStyle === s.slug ? undefined : s.slug })} className={chip(activeStyle === s.slug, "style")}>{s.name}</Link>)}
          </Row>
        )}

        {/* Colour */}
        {colours.length > 0 && (
          <Row label="Colour">
            {colours.map((c) => <Link key={c} href={qs({ color: activeColor === c ? undefined : c })} className={`text-xs ${chip(activeColor === c, "color")}`}>{c} ({colourCounts.get(c)})</Link>)}
          </Row>
        )}

        {/* Discount + Rating */}
        <Row label="Discount">
          {[["", "Any"], ["10", "10%+"], ["20", "20%+"], ["30", "30%+"]].map(([k, lbl]) => (
            <Link key={k} href={qs({ disc: k || undefined })} className={`text-xs ${chip((searchParams.disc ?? "") === k, "type")}`}>{lbl}</Link>
          ))}
        </Row>
        <Row label="Rating">
          {[["", "Any"], ["4", "4★ & up"], ["4.5", "4.5★ & up"]].map(([k, lbl]) => (
            <Link key={k} href={qs({ rating: k || undefined })} className={`text-xs ${chip((searchParams.rating ?? "") === k, "type")}`}>{lbl}</Link>
          ))}
        </Row>

        {/* Price + in stock + sort */}
        <div className="flex flex-wrap items-end gap-3 pt-1 border-t border-sand/60">
          <form className="flex items-end gap-2" action={`/shop/c/${params.slug}`}>
            {(["sort", "stock", "sub", "style", "color", "disc", "rating", "label"] as const).map((k) => searchParams[k] ? <input key={k} type="hidden" name={k} value={searchParams[k]} /> : null)}
            <label className="text-xs text-muted">Min ₹<input name="min" defaultValue={searchParams.min} inputMode="numeric" className={`${inp} block mt-1`} /></label>
            <label className="text-xs text-muted">Max ₹<input name="max" defaultValue={searchParams.max} inputMode="numeric" className={`${inp} block mt-1`} /></label>
            <button className="px-4 py-1.5 rounded-full bg-ink text-white text-sm">Apply</button>
          </form>
          <Link href={qs({ stock: inStockOnly ? undefined : "1" })} className={chip(inStockOnly, "type")}>In stock only</Link>
          <div className="flex items-center gap-1.5 ml-auto text-sm">
            <span className="text-muted">Sort:</span>
            {[["", "Featured"], ["price", "Price ↑"], ["price-desc", "Price ↓"], ["rating", "Top rated"]].map(([k, label]) => (
              <Link key={k} href={qs({ sort: k || undefined })} className={`px-2.5 py-1 rounded-full border text-xs transition-colors ${(searchParams.sort ?? "") === k ? "border-emerald text-emerald bg-emerald-mist" : "border-sand text-muted hover:border-emerald"}`}>{label}</Link>
            ))}
          </div>
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
