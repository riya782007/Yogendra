export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductBySku, getProductSalesStats, getPricingFormula } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { formatPaise } from "@/lib/pricing";
import { getSession, can } from "@/lib/auth";
import { setProductVisibilityAction } from "@/app/actions/catalog";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";
import { ProductTags } from "@/components/admin/ProductTags";

export const metadata = { title: "Owner Console · Product 360" };

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-card">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${accent ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

export default async function Product360({ params }: { params: { sku: string } }) {
  const sku = params.sku.toUpperCase();
  const [p, stats, formula] = await Promise.all([getProductBySku(sku), getProductSalesStats(sku), getPricingFormula()]);
  if (!p) notFound();
  const o = liveOffer(p.base_wholesale, formula);
  const gc = (p.generated_content as any) ?? {};
  const tags: string[] = gc.tags ?? [];
  const session = getSession();
  const published = p.status === "published";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <Link href="/admin/inventory" className="text-sm text-muted hover:text-ink">← Inventory</Link>
        <span className={`text-xs px-2 py-0.5 rounded-full ${published ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>{published ? "Visible on store" : "Hidden"}</span>
      </div>
      <h1 className="font-display text-4xl text-ink">{p.name}</h1>
      <p className="text-sm text-muted mb-4">{p.category?.name} · {p.sku}</p>

      {/* Internal notes — admin-only status tags (inventory updated, images sorted…). Never on store. */}
      <div className="mb-5 rounded-2xl bg-white p-4 shadow-card">
        <p className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Internal notes <span className="normal-case font-normal">· only staff see these, never on the storefront</span></p>
        <ProductTags sku={p.sku} initial={(p as any).admin_tags ?? []} canEdit={can(session, "catalog.edit")} />
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat label="Units sold" value={String(stats?.units ?? 0)} />
        <Stat label="Revenue" value={formatPaise(stats?.revenue ?? 0)} accent="text-emerald" />
        <Stat label="Orders" value={String(stats?.orders ?? 0)} />
        <Stat label="In stock" value={String(p.qty)} accent={p.qty <= 2 ? "text-rose" : undefined} />
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link href={`/shop/${p.category?.slug}/${p.sku}`} target="_blank" className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">View on store ↗</Link>
        {can(session, "catalog.view") && <Link href={`/admin/products/${(p as any).id}`} className="px-4 py-2 rounded-full bg-ink text-white text-sm hover:bg-ink/90">⚙ Manage product</Link>}
        {can(session, "catalog.edit") && <Link href={`/admin/catalogue/${p.sku}`} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">✎ Edit</Link>}
        {can(session, "catalog.publish") && (
          <form action={setProductVisibilityAction}>
            <input type="hidden" name="sku" value={p.sku} />
            <input type="hidden" name="status" value={published ? "draft" : "published"} />
            <button className="px-4 py-2 rounded-full bg-gold/15 text-gold-dark text-sm hover:bg-gold/25">{published ? "Hide from store" : "Show on store"}</button>
          </form>
        )}
        {can(session, "catalog.delete") && <DeleteProductButton sku={p.sku} className="px-4 py-2 rounded-full bg-rose/10 text-rose text-sm hover:bg-rose/20" label="🗑 Delete" />}
      </div>

      {/* Details */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <h2 className="font-medium text-ink mb-3">Pricing</h2>
          <div className="text-sm space-y-1.5">
            <div className="flex justify-between"><span className="text-muted">Retail price</span><span className="font-medium">{formatPaise(o.price)}</span></div>
            <div className="flex justify-between"><span className="text-muted">MRP</span><span>{formatPaise(o.mrp)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Base wholesale</span><span>{formatPaise(p.base_wholesale)}</span></div>
            <div className="flex justify-between"><span className="text-muted">Type</span><span className="capitalize">{p.type}</span></div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <h2 className="font-medium text-ink mb-3">Photos &amp; content</h2>
          <p className="text-sm text-muted">{(p.images ?? []).length} photo(s) · AI page {gc.title ? "written ✓" : "not yet"}</p>
          {tags.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{tags.slice(0, 10).map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-mist text-emerald-dark">{t}</span>)}</div>}
        </div>
      </div>

      {gc.description && (
        <div className="bg-white rounded-2xl p-5 shadow-card mt-4">
          <h2 className="font-medium text-ink mb-2">Description</h2>
          <p className="text-sm text-ink/80 leading-relaxed">{gc.description}</p>
        </div>
      )}
    </main>
  );
}
