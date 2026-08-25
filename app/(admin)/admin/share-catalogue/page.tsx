export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCatalogProductsCached, getCategoryTreeCached, getCatalogSuggestionsCached, getStyles } from "@/lib/supabase/queries";
import { CatalogSearch } from "@/components/site/CatalogSearch";
import { SelectableCatalog } from "@/components/site/SelectableCatalog";
import { BUSINESS } from "@/lib/business";
import { SITE } from "@/lib/siteUrl";
import { requirePerm } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Owner Console · Share Catalogue" };

const BASE = "/admin/share-catalogue";

export default async function ShareCatalogueComposer({ searchParams }: { searchParams: { category?: string; subcategory?: string; style?: string; view?: string; q?: string; skus?: string } }) {
  if (!(await requirePerm("catalog.view"))) redirect("/admin/dashboard?denied=catalogue");

  const category = searchParams.category ?? "all";
  const subcategory = searchParams.subcategory ?? "all";
  const style = searchParams.style ?? "all";
  const q = (searchParams.q ?? "").trim();
  const skus = (searchParams.skus ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const view: "retail" | "wholesale" = searchParams.view === "retail" ? "retail" : "wholesale";

  const [tree, fetched, suggestions] = await Promise.all([
    getCategoryTreeCached(),
    getCatalogProductsCached({ category, subcategory, style, q, skus: skus.length ? skus : undefined, includeWholesaleOnly: view === "wholesale", excludeRetailOnly: view === "wholesale", includeWholesalePricing: true, inStock: true }),
    getCatalogSuggestionsCached().catch(() => ({ products: [], categories: [], colours: [] })),
  ]);
  let products = fetched;
  let subFellBack = false;
  if (products.length === 0 && subcategory !== "all" && skus.length === 0) {
    products = await getCatalogProductsCached({ category, q, includeWholesalePricing: true, inStock: true });
    subFellBack = products.length > 0;
  }

  const activeCat = tree.find((c) => c.slug === category);
  const subs = activeCat?.subcategories ?? [];
  const activeSub = subs.find((s) => s.slug === subcategory);
  const styleChips = activeCat ? await getStyles({ categoryId: activeCat.id }).catch(() => []) : [];

  const scopeName = skus.length
    ? `${skus.length} selected pieces`
    : activeSub ? activeSub.name
    : activeCat ? activeCat.name
    : q ? `“${q}”`
    : "Full collection";

  const viewQ = view === "wholesale" ? "&view=wholesale" : "&view=retail";
  const subQ = subcategory !== "all" ? `&subcategory=${subcategory}` : "";
  const styleQ = style !== "all" ? `&style=${style}` : "";
  const chip = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm ${active ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.25em] text-gold-dark">Owner console</p>
          <h1 className="font-display text-4xl text-ink">Share Catalogue</h1>
          <p className="text-sm text-muted mt-1 max-w-xl">
            This is the composer. Set retail or wholesale, optionally pick pieces, then copy or WhatsApp the <b>customer</b> link.
            Customers open that link on the store — they will not see this page, the toggle, or any retail/wholesale tags.
          </p>
          <p className="text-sm text-ink mt-2">{scopeName} · {products.length} designs · {view === "wholesale" ? "Wholesale rates" : "Retail prices"}</p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <CatalogSearch suggestions={suggestions} view={view} initialQuery={q} basePath={BASE} />
          <div className="inline-flex rounded-full bg-white border border-sand p-1 text-sm">
            <Link href={{ pathname: BASE, query: qobj({ category, subcategory, style, q, skus: searchParams.skus, view: "retail" }) }} className={`px-3 py-1 rounded-full ${view === "retail" ? "bg-gold text-ink" : "text-muted"}`}>Retail</Link>
            <Link href={{ pathname: BASE, query: qobj({ category, subcategory, style, q, skus: searchParams.skus, view: "wholesale" }) }} className={`px-3 py-1 rounded-full ${view === "wholesale" ? "bg-gold text-ink" : "text-muted"}`}>Wholesale</Link>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-2">
        <Link href={`${BASE}?${(viewQ).replace(/^&/, "")}`} className={chip(category === "all" && !q && skus.length === 0)}>All</Link>
        {tree.map((c) => (
          <Link key={c.slug} href={`${BASE}?category=${c.slug}${viewQ}`} className={chip(category === c.slug && subcategory === "all")}>{c.name}</Link>
        ))}
      </div>

      {subs.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <span className="text-[10px] uppercase tracking-wide text-emerald-dark/70 mr-1">Type</span>
          <Link href={`${BASE}?category=${category}${styleQ}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${subcategory === "all" ? "bg-emerald text-white" : "bg-emerald-mist/60 text-emerald-dark hover:bg-emerald-mist"}`}>All {activeCat?.name}</Link>
          {subs.map((s) => (
            <Link key={s.slug} href={`${BASE}?category=${category}&subcategory=${s.slug}${styleQ}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${subcategory === s.slug ? "bg-emerald text-white" : "bg-emerald-mist/60 text-emerald-dark hover:bg-emerald-mist"}`}>{s.name}</Link>
          ))}
        </div>
      )}

      {styleChips.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <span className="text-[10px] uppercase tracking-wide text-gold-dark/70 mr-1">Style</span>
          <Link href={`${BASE}?category=${category}${subQ}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${style === "all" ? "bg-gold text-ink" : "bg-gold/15 text-gold-dark hover:bg-gold/25"}`}>All styles</Link>
          {styleChips.map((st) => (
            <Link key={st.slug} href={`${BASE}?category=${category}${subQ}&style=${st.slug}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${style === st.slug ? "bg-gold text-ink" : "bg-gold/15 text-gold-dark hover:bg-gold/25"}`}>{st.name}</Link>
          ))}
        </div>
      )}

      <div className="mt-4">
        {subFellBack && (
          <p className="text-xs text-muted mb-3">No designs are tagged under <b>{activeSub?.name}</b> yet — showing all of <b>{activeCat?.name}</b>.</p>
        )}
        <SelectableCatalog products={products} view={view} brand={BUSINESS.brand} phone={BUSINESS.phone} manage shareOrigin={SITE} />
      </div>
    </main>
  );
}

function qobj(o: { category?: string; subcategory?: string; style?: string; q?: string; skus?: string; view?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  if (o.category && o.category !== "all") out.category = o.category;
  if (o.subcategory && o.subcategory !== "all") out.subcategory = o.subcategory;
  if (o.style && o.style !== "all") out.style = o.style;
  if (o.q) out.q = o.q;
  if (o.skus) out.skus = o.skus;
  if (o.view) out.view = o.view;
  return out;
}
