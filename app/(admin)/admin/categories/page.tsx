export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import { createCategoryAction, deleteCategoryAction } from "@/app/actions/catalog";
import { getSession, can } from "@/lib/auth";

export const metadata = { title: "Owner Console · Categories" };

export default async function Categories() {
  const sb = supabaseServer();
  const { data: cats } = await sb.from("categories").select("id,name,slug").order("name");
  const { data: prods } = await sb.from("products").select("category_id");
  const counts = new Map<string, number>();
  for (const p of (prods as any[]) ?? []) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  const canEdit = can(getSession(), "catalog.edit");

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-3xl">
      <h1 className="font-display text-4xl text-ink mb-1">Categories</h1>
      <p className="text-sm text-muted mb-6">Organise your catalogue. Categories appear in the storefront menu instantly.</p>

      <form action={createCategoryAction} className="flex gap-2 mb-6">
        <input name="name" placeholder="New category name (e.g. Maang Tikka)" className="flex-1 rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
        <button className="btn-primary px-6 text-sm font-medium">Create</button>
      </form>

      <div className="grid sm:grid-cols-2 gap-3">
        {((cats as any[]) ?? []).map((c) => (
          <div key={c.id} className="bg-white rounded-2xl p-5 shadow-card flex items-center justify-between gap-3 hover:shadow-luxe transition-shadow">
            <div className="min-w-0"><p className="font-medium text-ink truncate">{c.name}</p><p className="text-xs text-muted">/shop/c/{c.slug}</p></div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm text-emerald font-medium">{counts.get(c.id) ?? 0} designs</span>
              {canEdit && (counts.get(c.id) ?? 0) === 0 && (
                <form action={deleteCategoryAction}><input type="hidden" name="id" value={c.id} /><button title="Delete empty category" className="text-muted hover:text-rose text-sm">🗑</button></form>
              )}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
