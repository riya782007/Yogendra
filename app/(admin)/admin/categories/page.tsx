export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import {
  createCategoryAction, deleteCategoryAction,
  createSubcategoryAction, deleteSubcategoryAction, setSubcategoryStyleAction,
  createLabelAction, deleteLabelAction,
} from "@/app/actions/catalog";
import { getCategoryTree, getLabels } from "@/lib/supabase/queries";
import { getSession, can } from "@/lib/auth";
import { CollapsibleCategory } from "@/components/admin/CollapsibleCategory";

export const metadata = { title: "Owner Console · Categories" };

const LABEL_CHIP: Record<string, string> = {
  emerald: "bg-emerald-mist text-emerald-dark", gold: "bg-gold/15 text-gold-dark",
  wine: "bg-wine/10 text-wine", rose: "bg-rose/10 text-rose",
  blue: "bg-blue-50 text-blue-700", ink: "bg-ink/10 text-ink",
};

export default async function Categories({ searchParams }: { searchParams: { q?: string } }) {
  const sb = supabaseServer();
  const [tree, labels, { data: prods }] = await Promise.all([
    getCategoryTree(),
    getLabels(),
    sb.from("products").select("category_id"),
  ]);
  const counts = new Map<string, number>();
  for (const p of (prods as any[]) ?? []) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  const canEdit = can(getSession(), "catalog.edit");

  // Filter: match a parent name OR any of its subcategory names, so searching "kundan"
  // surfaces the parent that contains a Kundan subcategory. When searching, matching
  // cards open by default so the owner sees the hit without an extra click.
  const q = (searchParams.q ?? "").trim().toLowerCase();
  const filtered = q
    ? tree.filter((c) => c.name.toLowerCase().includes(q) || c.subcategories.some((s) => s.name.toLowerCase().includes(q)))
    : tree;

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Categories &amp; Subcategories</h1>
      <p className="text-sm text-muted mb-6">Organise your catalogue into parent categories (Necklaces, Earrings…) and subcategories (Oxidised, Kundan, Temple…). Tap a category to expand its subcategories. Changes appear in the storefront menu and catalogue filters instantly.</p>

      {/* Search across categories + subcategories */}
      <form action="/admin/categories" className="flex gap-2 mb-4">
        <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search categories or subcategories…" className="flex-1 rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
        <button className="px-5 rounded-xl bg-ink text-white text-sm">Search</button>
        {q && <a href="/admin/categories" className="px-4 grid place-items-center rounded-xl border border-sand text-sm text-muted hover:text-ink">Clear</a>}
      </form>

      {canEdit && (
        <form action={createCategoryAction} className="flex gap-2 mb-8">
          <input name="name" placeholder="New parent category (e.g. Necklaces)" className="flex-1 rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
          <button className="btn-primary px-6 text-sm font-medium">Add category</button>
        </form>
      )}

      <div className="space-y-3">
        {tree.length === 0 && <p className="text-sm text-muted">No categories yet — add your first one above.</p>}
        {tree.length > 0 && filtered.length === 0 && <p className="text-sm text-muted">No category or subcategory matches “{searchParams.q}”. <a href="/admin/categories" className="text-emerald nav-link">Clear search</a>.</p>}
        {filtered.map((c) => (
          <CollapsibleCategory
            key={c.id}
            id={c.id}
            title={c.name}
            meta={`/shop/c/${c.slug}`}
            designCount={counts.get(c.id) ?? 0}
            subCount={c.subcategories.length}
            defaultOpen={!!q}
            actions={canEdit && (counts.get(c.id) ?? 0) === 0 ? (
              <form action={deleteCategoryAction}><input type="hidden" name="id" value={c.id} /><button title="Delete empty category" className="text-muted hover:text-rose text-sm">🗑</button></form>
            ) : null}
          >
            {/* Subcategories */}
            <div className="flex flex-col gap-1.5 mb-3">
              {c.subcategories.length === 0 && <span className="text-xs text-muted italic">No subcategories yet.</span>}
              {c.subcategories.map((s) => (
                <div key={s.id} className="flex items-center gap-2 flex-wrap">
                  {/* Pillar 12 — subcategories are navigable: tap to open that subcategory's
                      products on the storefront (the /shop/c/<cat>?sub=<slug> filter). */}
                  <a
                    href={`/shop/c/${c.slug}?sub=${s.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    title={`View ${s.name} products`}
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-mist/60 text-emerald-dark text-xs px-3 py-1.5 hover:bg-emerald-mist transition-colors"
                  >
                    {s.name} <span aria-hidden className="opacity-60">↗</span>
                  </a>
                  {canEdit && (
                    <form action={setSubcategoryStyleAction} className="inline-flex items-center gap-1">
                      <input type="hidden" name="id" value={s.id} />
                      <select name="style" defaultValue={s.image_style ?? "auto"} title="AI model for this subcategory's photos" className="rounded-lg border border-sand px-2 py-1 text-xs bg-white outline-none focus:border-emerald">
                        <option value="auto">Auto model</option>
                        <option value="indian">Indian model</option>
                        <option value="western">Western model</option>
                      </select>
                      <button className="px-2 py-1 rounded-lg bg-ink/5 text-ink text-[11px] hover:bg-ink/10">Set</button>
                    </form>
                  )}
                  {canEdit && (
                    <form action={deleteSubcategoryAction} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <button title="Remove subcategory" className="text-muted hover:text-rose leading-none px-1">×</button>
                    </form>
                  )}
                </div>
              ))}
            </div>

            {canEdit && (
              <form action={createSubcategoryAction} className="flex gap-2">
                <input type="hidden" name="category_id" value={c.id} />
                <input name="name" placeholder={`Add subcategory to ${c.name} (e.g. Oxidised)`} className="flex-1 rounded-lg border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald" />
                <button className="px-4 py-2 rounded-lg border border-emerald text-emerald text-sm font-medium hover:bg-emerald-mist/40">+ Subcategory</button>
              </form>
            )}
          </CollapsibleCategory>
        ))}
      </div>

      {/* Labels (#9/#31) — owner-defined tags you can stick on any SKU */}
      <div className="mt-10">
        <h2 className="font-display text-2xl text-ink mb-1">Labels</h2>
        <p className="text-sm text-muted mb-4">Make your own labels (e.g. “New”, “Bestseller”, “Bridal”, “Clearance”) and attach them to products from each SKU’s Catalog tab.</p>
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <div className="flex flex-wrap gap-2 mb-4">
            {labels.length === 0 && <span className="text-sm text-muted italic">No labels yet.</span>}
            {labels.map((l: any) => (
              <span key={l.id} className={`inline-flex items-center gap-1.5 rounded-full text-xs px-3 py-1.5 ${LABEL_CHIP[l.color] ?? LABEL_CHIP.emerald}`}>
                {l.name}
                {canEdit && (
                  <form action={deleteLabelAction} className="inline"><input type="hidden" name="id" value={l.id} /><button title="Delete label" className="opacity-60 hover:text-rose leading-none">×</button></form>
                )}
              </span>
            ))}
          </div>
          {canEdit && (
            <form action={createLabelAction} className="flex flex-wrap gap-2 items-center border-t border-sand/60 pt-4">
              <input name="name" placeholder="New label (e.g. Bestseller)" className="flex-1 min-w-[160px] rounded-lg border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald" />
              <select name="color" className="rounded-lg border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald">
                {["emerald", "gold", "wine", "rose", "blue", "ink"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button className="px-4 py-2 rounded-lg border border-emerald text-emerald text-sm font-medium hover:bg-emerald-mist/40">+ Label</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
