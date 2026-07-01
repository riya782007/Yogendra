export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCatalogProducts, getCategoryTree, getCatalogSuggestions, getStyles } from "@/lib/supabase/queries";
import { CatalogShareBar } from "@/components/site/CatalogShareBar";
import { CatalogSearch } from "@/components/site/CatalogSearch";
import { SelectableCatalog } from "@/components/site/SelectableCatalog";
import { BUSINESS } from "@/lib/business";
import { getSession } from "@/lib/auth";
import { getWholesaleSession } from "@/lib/wholesale";

export const metadata = { title: "Catalogue — Blythe Diva" };

export default async function Catalog({ searchParams }: { searchParams: { category?: string; subcategory?: string; style?: string; view?: string; q?: string; skus?: string } }) {
  const category = searchParams.category ?? "all";
  const subcategory = searchParams.subcategory ?? "all";
  const style = searchParams.style ?? "all";
  const q = (searchParams.q ?? "").trim();
  const skus = (searchParams.skus ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  // AUTHORIZATION GATE: the wholesale view + trade pricing are only available to an
  // authenticated admin/staff OR an approved dealer. A retail visitor (or anyone who
  // receives a shared ?view=wholesale link) is silently forced back to the retail view,
  // and trade prices are never fetched or serialized for them.
  const canSeeWholesale = getSession().authed || !!(await getWholesaleSession());
  const view: "retail" | "wholesale" = searchParams.view === "wholesale" && canSeeWholesale ? "wholesale" : "retail";

  const [tree, fetched, suggestions] = await Promise.all([
    getCategoryTree(),
    getCatalogProducts({ category, subcategory, style, q, skus: skus.length ? skus : undefined, includeWholesaleOnly: view === "wholesale", excludeRetailOnly: view === "wholesale", includeWholesalePricing: view === "wholesale" }),
    getCatalogSuggestions().catch(() => ({ products: [], categories: [], colours: [] })),
  ]);
  // Never dead-end a shared sub-category link: if nothing is tagged there yet,
  // fall back to the whole parent category so the catalogue always shows stock.
  let products = fetched;
  let subFellBack = false;
  if (products.length === 0 && subcategory !== "all" && skus.length === 0) {
    products = await getCatalogProducts({ category, q });
    subFellBack = products.length > 0;
  }

  const activeCat = tree.find((c) => c.slug === category);
  const subs = activeCat?.subcategories ?? [];
  const activeSub = subs.find((s) => s.slug === subcategory);
  // Styles for the active category (2nd filter dimension). Only fetched when a category is active.
  const styleChips = activeCat ? await getStyles({ categoryId: activeCat.id }).catch(() => []) : [];

  const scopeName = skus.length
    ? `${skus.length} selected pieces`
    : activeSub ? activeSub.name
    : activeCat ? activeCat.name
    : q ? `“${q}”`
    : "Full Collection";
  const shareText = `${BUSINESS.brand} — ${scopeName}${view === "wholesale" ? " (wholesale)" : ""} catalogue`;

  // Helpers to build chip links that preserve the view + the OTHER active filter (2-basis filter).
  const viewQ = view === "wholesale" ? "&view=wholesale" : "";
  const subQ = subcategory !== "all" ? `&subcategory=${subcategory}` : "";
  const styleQ = style !== "all" ? `&style=${style}` : "";
  const chip = (active: boolean) =>
    `px-3.5 py-1.5 rounded-full text-sm ${active ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`;

  return (
    <main className="min-h-screen bg-ivory">
      {/* Header */}
      <div className="bg-ink text-cream catalog-dark">
        <div className="max-w-6xl mx-auto px-5 py-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-gold-light">{BUSINESS.legalName} · Sadar Bazar, Delhi</p>
            <h1 className="font-display text-4xl text-ivory mt-1">{BUSINESS.brand}</h1>
            <p className="text-cream/70 text-sm mt-1">{scopeName} · {products.length} designs · {view === "wholesale" ? "Wholesale rates" : "Retail prices"} · WhatsApp {BUSINESS.phone}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {/* Search with live suggestions — designs, SKUs, categories, colours. */}
            <CatalogSearch suggestions={suggestions} view={view} initialQuery={q} />
            {/* Retail / Wholesale toggle — shown ONLY to authenticated admin/dealer users. */}
            {canSeeWholesale && (
              <div className="no-print inline-flex rounded-full bg-white/10 p-1 text-sm">
                <Link href={{ pathname: "/catalog", query: cleanQuery({ category, subcategory, style, q, skus: searchParams.skus }) }} className={`px-3 py-1 rounded-full ${view === "retail" ? "bg-gold text-ink" : "text-cream/80"}`}>Retail</Link>
                <Link href={{ pathname: "/catalog", query: cleanQuery({ category, subcategory, style, q, skus: searchParams.skus, view: "wholesale" }) }} className={`px-3 py-1 rounded-full ${view === "wholesale" ? "bg-gold text-ink" : "text-cream/80"}`}>Wholesale</Link>
              </div>
            )}
            <CatalogShareBar shareText={shareText} />
          </div>
        </div>
      </div>

      {/* Category chips */}
      <div className="no-print max-w-6xl mx-auto px-5 pt-5 flex flex-wrap gap-2">
        <Link href={`/catalog?${viewQ.slice(1)}`} className={chip(category === "all" && !q && skus.length === 0)}>All</Link>
        {tree.map((c) => (
          <Link key={c.slug} href={`/catalog?category=${c.slug}${viewQ}`} className={chip(category === c.slug && subcategory === "all")}>{c.name}</Link>
        ))}
      </div>

      {/* Subcategory ("Type") chips — preserve the active style so both filters stack. */}
      {subs.length > 0 && (
        <div className="no-print max-w-6xl mx-auto px-5 pt-2 flex flex-wrap gap-2 items-center">
          <span className="text-[10px] uppercase tracking-wide text-emerald-dark/70 mr-1">Type</span>
          <Link href={`/catalog?category=${category}${styleQ}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${subcategory === "all" ? "bg-emerald text-white" : "bg-emerald-mist/60 text-emerald-dark hover:bg-emerald-mist"}`}>All {activeCat?.name}</Link>
          {subs.map((s) => (
            <Link key={s.slug} href={`/catalog?category=${category}&subcategory=${s.slug}${styleQ}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${subcategory === s.slug ? "bg-emerald text-white" : "bg-emerald-mist/60 text-emerald-dark hover:bg-emerald-mist"}`}>{s.name}</Link>
          ))}
        </div>
      )}

      {/* Style chips — the 2nd filter dimension; preserve the active subcategory so both stack. */}
      {styleChips.length > 0 && (
        <div className="no-print max-w-6xl mx-auto px-5 pt-2 flex flex-wrap gap-2 items-center">
          <span className="text-[10px] uppercase tracking-wide text-gold-dark/70 mr-1">Style</span>
          <Link href={`/catalog?category=${category}${subQ}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${style === "all" ? "bg-gold text-ink" : "bg-gold/15 text-gold-dark hover:bg-gold/25"}`}>All styles</Link>
          {styleChips.map((st) => (
            <Link key={st.slug} href={`/catalog?category=${category}${subQ}&style=${st.slug}${viewQ}`} className={`px-3 py-1 rounded-full text-xs ${style === st.slug ? "bg-gold text-ink" : "bg-gold/15 text-gold-dark hover:bg-gold/25"}`}>{st.name}</Link>
          ))}
        </div>
      )}

      {/* Cards + select-to-share */}
      <div className="max-w-6xl mx-auto px-5 py-6">
        {subFellBack && (
          <p className="no-print text-xs text-muted mb-3">No designs are tagged under <b>{activeSub?.name}</b> yet — showing all of <b>{activeCat?.name}</b>.</p>
        )}
        <SelectableCatalog products={products} view={view} brand={BUSINESS.brand} phone={BUSINESS.phone} />
      </div>

      <div className="bg-ink text-cream/70 text-center text-sm py-6 mt-6 catalog-dark">
        <p className="text-ivory font-display text-2xl">{BUSINESS.brand}</p>
        <p className="mt-1">Order on WhatsApp: <a href={`https://wa.me/91${BUSINESS.phone.replace(/\D/g, "").slice(-10)}`} className="text-gold-light">{BUSINESS.phone}</a> · {BUSINESS.address}</p>
      </div>
    </main>
  );
}

/** Build a query object dropping empty/all values (keeps URLs clean). */
function cleanQuery(o: { category?: string; subcategory?: string; style?: string; q?: string; skus?: string; view?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  if (o.category && o.category !== "all") out.category = o.category;
  if (o.subcategory && o.subcategory !== "all") out.subcategory = o.subcategory;
  if (o.style && o.style !== "all") out.style = o.style;
  if (o.q) out.q = o.q;
  if (o.skus) out.skus = o.skus;
  if (o.view) out.view = o.view;
  return out;
}
