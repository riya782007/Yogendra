export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import {
  createCategoryAction, deleteCategoryAction,
  createSubcategoryAction, deleteSubcategoryAction,
  createLabelAction, deleteLabelAction,
} from "@/app/actions/catalog";
import { getCategoryTree, getLabels } from "@/lib/supabase/queries";
import { getSession, can } from "@/lib/auth";

export const metadata = { title: "Owner Console · Categories" };

const LABEL_CHIP: Record<string, string> = {
  emerald: "bg-emerald-mist text-emerald-dark", gold: "bg-gold/15 text-gold-dark",
  wine: "bg-wine/10 text-wine", rose: "bg-rose/10 text-rose",
  blue: "bg-blue-50 text-blue-700", ink: "bg-ink/10 text-ink",
};

export default async function Categories() {
  const sb = supabaseServer();
  const [tree, labels, { data: prods }] = await Promise.all([
    getCategoryTree(),
    getLabels(),
    sb.from("products").select("category_id"),
  ]);
  const counts = new Map<string, number>();
  for (const p of (prods as any[]) ?? []) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  const canEdit = can(getSession(), "catalog.edit");

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Categories &amp; Subcategories</h1>
      <p className="text-sm text-muted mb-6">Organise your catalogue into parent categories (Necklaces, Earrings…) and subcategories (Oxidised, Kundan, Temple…). Changes appear in the storefront menu and catalogue filters instantly.</p>

      {canEdit && (
        <form action={createCategoryAction} className="flex gap-2 mb-8">
          <input name="name" placeholder="New parent category (e.g. Necklaces)" className="flex-1 rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
          <button className="btn-primary px-6 text-sm font-medium">Add category</button>
        </form>
      )}

      <div className="space-y-4">
        {tree.length === 0 && <p className="text-sm text-muted">No categories yet — add your first one above.</p>}
        {tree.map((c) => (
          <div key={c.id} className="bg-white rounded-2xl p-5 shadow-card hover:shadow-luxe transition-shadow">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="font-medium text-ink text-lg truncate">{c.name}</p>
                <p className="text-xs text-muted">/shop/c/{c.slug} · {c.subcategories.length} subcategories</p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm text-emerald font-medium">{counts.get(c.id) ?? 0} designs</span>
                {canEdit && (counts.get(c.id) ?? 0) === 0 && (
                  <form action={deleteCategoryAction}><input type="hidden" name="id" value={c.id} /><button title="Delete empty category" className="text-muted hover:text-rose text-sm">🗑</button></form>
                )}
              </div>
            </div>

            {/* Subcategories */}
            <div className="flex flex-wrap gap-2 mb-3">
              {c.subcategories.length === 0 && <span className="text-xs text-muted italic">No subcategories yet.</span>}
              {c.subcategories.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-emerald-mist/60 text-emerald-dark text-xs px-3 py-1.5">
                  {s.name}
                  {canEdit && (
                    <form action={deleteSubcategoryAction} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <button title="Remove subcategory" className="text-emerald-dark/60 hover:text-rose leading-none">×</button>
                    </form>
                  )}
                </span>
              ))}
            </div>

            {canEdit && (
              <form action={createSubcategoryAction} className="flex gap-2">
                <input type="hidden" name="category_id" value={c.id} />
                <input name="name" placeholder={`Add subcategory to ${c.name} (e.g. Oxidised)`} className="flex-1 rounded-lg border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald" />
                <button className="px-4 py-2 rounded-lg border border-emerald text-emerald text-sm font-medium hover:bg-emerald-mist/40">+ Subcategory</button>
              </form>
            )}
          </div>
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
