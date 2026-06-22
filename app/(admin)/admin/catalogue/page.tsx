export const dynamic = "force-dynamic";
import Link from "next/link";
import { getProductsPage, getPricingFormula, getCategories } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { formatPaise } from "@/lib/pricing";
import { geminiConfigured } from "@/lib/ai/gemini";
import { aiProvidersStatus } from "@/lib/ai/listingAgent";
import { ProductImage } from "@/components/Placeholder";
import { generateContentAction, generateAllContentAction } from "@/app/actions/aiContent";
import { GeneratePhotoButton } from "@/components/admin/GeneratePhotoButton";
import { generateEmbeddingsAction } from "@/app/actions/embeddings";
import { Pager } from "@/components/admin/Pager";
import { getSession, can } from "@/lib/auth";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";

export const metadata = { title: "Owner Console · Catalogue" };
const PAGE_SIZE = 25;

export default async function AdminCatalogue({ searchParams }: { searchParams: { page?: string; q?: string; category?: string; status?: string } }) {
  const page = parseInt(searchParams.page ?? "1", 10) || 1;
  const q = searchParams.q ?? "";
  const category = searchParams.category ?? "all";
  const status = searchParams.status ?? "all";
  const [{ rows, total }, formula, categories] = await Promise.all([
    getProductsPage({ page, pageSize: PAGE_SIZE, q, category, status }),
    getPricingFormula(),
    getCategories(),
  ]);
  const ai = aiProvidersStatus();
  const imageReady = geminiConfigured();
  const session = getSession();
  const canEdit = can(session, "catalog.edit");
  const canAi = can(session, "catalog.ai");
  const canDelete = can(session, "catalog.delete");

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
      <form action="/admin/catalogue" className="flex flex-wrap gap-2 mb-4">
        <input name="q" defaultValue={q} placeholder="Search name or SKU…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[180px]" />
        <select name="category" defaultValue={category} className={sel}>
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
        </select>
        <select name="status" defaultValue={status} className={sel}>
          <option value="all">All statuses</option><option value="published">Published</option><option value="draft">Draft</option><option value="flagged">Flagged</option>
        </select>
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Search</button>
        {(q || category !== "all" || status !== "all") && <Link href="/admin/catalogue" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr>
              <th className="p-3">Photo</th><th className="p-3">Product</th><th className="p-3">Category · No.</th>
              <th className="p-3">Stock</th><th className="p-3">Price (live)</th><th className="p-3">Edit</th><th className="p-3">View</th><th className="p-3">AI page</th><th className="p-3">AI photo</th><th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="p-4 text-muted">No products match.</td></tr>}
            {rows.map((p: any) => {
              const o = liveOffer(p.base_wholesale, formula);
              const hasAi = !!(p.generated_content && p.generated_content.title);
              return (
                <tr key={p.id} className="border-t border-sand/60 hover:bg-cream/40 transition-colors">
                  <td className="p-2"><div className="w-11 h-13 rounded-lg overflow-hidden"><ProductImage name={p.name} /></div></td>
                  <td className="p-3 font-medium text-ink">{p.name}{p.status !== "published" && <span className="ml-1 text-[10px] uppercase text-gold-dark">· {p.status}</span>}</td>
                  <td className="p-3 text-muted">{p.category?.name} · {p.sku}</td>
                  <td className="p-3"><span className={p.qty <= 2 ? "text-rose font-medium" : "text-ink"}>{p.qty}</span></td>
                  <td className="p-3"><span className="font-semibold">{formatPaise(o.price)}</span>{o.hasOffer && <span className="text-xs text-rose ml-1">{o.offerPct}% off</span>}</td>
                  <td className="p-3">{canEdit ? <Link className="px-3 py-1.5 rounded-full bg-ink/5 text-ink text-xs font-medium hover:bg-ink/10 transition-colors" href={`/admin/catalogue/${p.sku}`}>✎ Edit</Link> : <span className="text-xs text-muted">—</span>}</td>
                  <td className="p-3 whitespace-nowrap"><Link className="text-ink/70 hover:text-ink text-xs mr-2" href={`/admin/product/${p.sku}`}>360°</Link><Link className="text-emerald nav-link" href={`/shop/${p.category?.slug}/${p.sku}`}>view ↗</Link></td>
                  <td className="p-3">
                    {canAi ? (
                      <form action={genContent} className="flex items-center gap-2">
                        <input type="hidden" name="sku" value={p.sku} />
                        <button className="px-3 py-1.5 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20 transition-colors">{hasAi ? "Regenerate" : "Generate"}</button>
                      </form>
                    ) : <span className="text-xs text-muted">{hasAi ? "✓" : "—"}</span>}
                  </td>
                  <td className="p-3">{canAi ? <GeneratePhotoButton sku={p.sku} /> : <span className="text-xs text-muted">—</span>}</td>
                  <td className="p-3">{canDelete && <DeleteProductButton sku={p.sku} className="text-muted hover:text-rose text-sm" label="🗑" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager basePath="/admin/catalogue" params={{ q, category, status }} page={page} pageSize={PAGE_SIZE} total={total} />
    </main>
  );
}
