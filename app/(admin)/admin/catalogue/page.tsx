export const dynamic = "force-dynamic";
import Link from "next/link";
import { getProductsPage, getPricingFormula, getCategoryTree } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { formatPaise, resolvePrices, overridesOf } from "@/lib/pricing";
import { geminiConfigured } from "@/lib/ai/gemini";
import { aiProvidersStatus } from "@/lib/ai/listingAgent";
import { generateContentAction, generateAllContentAction } from "@/app/actions/aiContent";
import { generateEmbeddingsAction } from "@/app/actions/embeddings";
import { Pager } from "@/components/admin/Pager";
import { getSession, can } from "@/lib/auth";
import { CatalogueRow } from "@/components/admin/CatalogueRow";
import { MoreDesignsBulk } from "@/components/admin/MoreDesignsBulk";

export const metadata = { title: "Owner Console · Catalogue" };
const PAGE_SIZE = 25;

export default async function AdminCatalogue({ searchParams }: { searchParams: { page?: string; q?: string; category?: string; sub?: string; status?: string; stock?: string } }) {
  const page = parseInt(searchParams.page ?? "1", 10) || 1;
  const q = searchParams.q ?? "";
  const category = searchParams.category ?? "all";
  const subcategory = searchParams.sub ?? "all";
  const status = searchParams.status ?? "all";
  const stock = searchParams.stock ?? "all";
  const [{ rows, total }, formula, categories] = await Promise.all([
    getProductsPage({ page, pageSize: PAGE_SIZE, q, category, subcategory, status, stock }),
    getPricingFormula(),
    getCategoryTree(),
  ]);
  // Subcategory options for the filter: when a category is chosen, show only its subcategories;
  // otherwise list every subcategory grouped by its parent category (optgroups).
  const catForSub = category !== "all" ? categories.filter((c) => c.slug === category) : categories;
  // Preserve the exact page + filters so a product's "← Catalogue" back-link returns HERE (e.g. page 174),
  // not page 1 — the efficient big-store behaviour.
  const retParams = new URLSearchParams();
  if (page > 1) retParams.set("page", String(page));
  if (q) retParams.set("q", q);
  if (category !== "all") retParams.set("category", category);
  if (subcategory !== "all") retParams.set("sub", subcategory);
  if (status !== "all") retParams.set("status", status);
  if (stock !== "all") retParams.set("stock", stock);
  const ret = `/admin/catalogue${retParams.toString() ? `?${retParams.toString()}` : ""}`;
  const ai = aiProvidersStatus();
  const imageReady = geminiConfigured();
  const session = getSession();
  const canEdit = can(session, "catalog.edit");
  const canAi = can(session, "catalog.ai");
  const canDelete = can(session, "catalog.delete");
  const canPublish = can(session, "catalog.publish");

  async function genContent(fd: FormData) { "use server"; await generateContentAction(String(fd.get("sku"))); }
  async function genAllContent() { "use server"; await generateAllContentAction(); }
  async function genEmbeddings() { "use server"; await generateEmbeddingsAction(); }

  const Pill = ({ on, label }: { on: boolean; label: string }) => (
    <span className={`text-xs px-2.5 py-1 rounded-full ${on ? "bg-emerald-mist text-emerald-dark" : "bg-cream text-muted"}`}>{on ? "●" : "○"} {label}</span>
  );
  const sel = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-display text-4xl text-ink">Catalogue</h1>
          <p className="text-sm text-muted">{total} products · AI-drafted pages, one-tap approve</p>
        </div>
        <div className="flex gap-2">
          <Link href="/catalog" target="_blank" className="px-4 py-2.5 text-sm font-medium rounded-full bg-gold text-ink hover:opacity-90 transition-opacity">📤 Share Catalogue ↗</Link>
          {canAi && <>
            <form action={genAllContent}><button className="btn-primary px-4 py-2.5 text-sm font-medium">✨ Generate all AI pages</button></form>
            <form action={genEmbeddings}><button className="px-4 py-2.5 text-sm font-medium rounded-full border border-emerald text-emerald hover:bg-emerald-mist transition-colors">⌖ Build recommendations</button></form>
          </>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <span className="text-xs text-muted mr-1">AI workforce:</span>
        <Pill on={ai.groq} label="Groq (text)" /><Pill on={ai.openai} label="OpenAI (fallback)" /><Pill on={imageReady} label="Gemini (photos)" />
      </div>

      {/* search + filters */}
      <MoreDesignsBulk categories={categories.map((c) => ({ id: c.id, name: c.name }))} />

      <form action="/admin/catalogue" className="flex flex-wrap gap-2 mb-4">
        <input name="q" defaultValue={q} placeholder="Search name or SKU…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[180px]" />
        <select name="category" defaultValue={category} className={sel}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
        <select name="sub" defaultValue={subcategory} className={sel}>
          <option value="all">All sub-categories</option>
          {category !== "all"
            ? (catForSub[0]?.subcategories ?? []).map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)
            : catForSub.map((c) => (
                <optgroup key={c.id} label={c.name}>
                  {c.subcategories.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
                </optgroup>
              ))}
        </select>
        <select name="status" defaultValue={status} className={sel}>
          <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="flagged">Flagged</option>
        </select>
        <select name="stock" defaultValue={stock} className={sel}>
          <option value="all">All stock</option><option value="in">In stock</option><option value="out">Out of stock</option>
        </select>
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Search</button>
        {(q || category !== "all" || subcategory !== "all" || status !== "all" || stock !== "all") && <Link href="/admin/catalogue" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>

      <p className="text-xs text-muted mb-2">Tip: click any product to expand it — publish, variants &amp; stock, AI and more.</p>
      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr>
              <th className="p-3">Photo</th><th className="p-3">Product</th><th className="p-3">Category · No.</th><th className="p-3">Price (live)</th><th className="p-3">Updates <span className="font-normal normal-case text-[10px]">· internal</span></th><th className="p-3 text-right"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-muted">No products match.</td></tr>}
            {rows.map((p: any) => {
              const o = liveOffer(p.base_wholesale, formula);
              const wholesaleRate = resolvePrices(p.base_wholesale, formula, overridesOf(p)).wholesaleRate;
              return (
                <CatalogueRow
                  key={p.id}
                  p={{
                    id: p.id, sku: p.sku, name: p.name, status: p.status,
                    image: p.image ?? null, categoryName: p.category?.name ?? "", categorySlug: p.category?.slug ?? "all",
                    qty: p.qty ?? 0, priceLabel: formatPaise(o.price), offerPct: o.offerPct, hasOffer: o.hasOffer,
                    hasAi: !!(p.generated_content && p.generated_content.title), variants: p.variants ?? [],
                    adminTags: p.admin_tags ?? [], wholesaleLabel: formatPaise(wholesaleRate),
                    moreDesigns: !!p.more_designs,
                  }}
                  canEdit={canEdit} canAi={canAi} canDelete={canDelete} canPublish={canPublish}
                  genContent={genContent} ret={ret}
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager basePath="/admin/catalogue" params={{ q, category, sub: subcategory, status, stock }} page={page} pageSize={PAGE_SIZE} total={total} />
    </main>
  );
}
