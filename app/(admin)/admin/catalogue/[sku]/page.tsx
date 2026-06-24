export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import {
  getProductBySku, getCategories, getPricingFormula, getSubcategories,
  getProductSalesStats, getStockHistory, getVariantOptions, getLabels,
} from "@/lib/supabase/queries";
import { ProductEditor, type EditorProduct } from "@/components/admin/ProductEditor";
import { ProductWorkspace, type WorkspaceTab, type TabKey } from "@/components/admin/ProductWorkspace";
import { ProductStockAdjust } from "@/components/admin/ProductStockAdjust";
import { MediaCard } from "@/components/admin/MediaCard";
import { requirePerm, getSession, can } from "@/lib/auth";
import { addVariantAction, updateVariantAction, deleteVariantAction, addVariantImageAction, deleteVariantImageAction } from "@/app/actions/variants";
import { setProductVisibilityAction, moveProductToSubcategoryAction, savePricingAction, setWholesaleOnlyAction, toggleProductLabelAction } from "@/app/actions/catalog";

const LABEL_CHIP: Record<string, string> = {
  emerald: "bg-emerald-mist text-emerald-dark", gold: "bg-gold/15 text-gold-dark",
  wine: "bg-wine/10 text-wine", rose: "bg-rose/10 text-rose",
  blue: "bg-blue-50 text-blue-700", ink: "bg-ink/10 text-ink",
};
import { formatPaise, computePrices, resolvePrices, overridesOf } from "@/lib/pricing";
import { geminiConfigured } from "@/lib/ai/gemini";

export const metadata = { title: "Owner Console · Product" };

const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";

function timeAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

export default async function ProductPage({ params, searchParams }: { params: { sku: string }; searchParams: { tab?: string } }) {
  if (!(await requirePerm("catalog.edit"))) redirect("/admin/dashboard?denied=editing+products");

  const [p, categories, formula] = await Promise.all([
    getProductBySku(params.sku),
    getCategories(),
    getPricingFormula(),
  ]);
  if (!p) notFound();

  const [subcategories, stats, history, vopts, allLabels] = await Promise.all([
    getSubcategories({ categoryId: p.category?.id }),
    getProductSalesStats(p.sku).catch(() => null),
    getStockHistory(p.id).catch(() => []),
    getVariantOptions().catch(() => ({ color: [], size: [], polish: [] })),
    getLabels().catch(() => []),
  ]);
  const labelIds = new Set((((p as any).product_labels as any[]) ?? []).map((x) => x.label_id));

  const session = getSession();
  const gc = (p.generated_content as any) ?? {};
  const seo = gc.seo ?? {};
  const specs = gc.specs ?? {};
  const specsText = Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join("\n");
  const tags: string[] = gc.tags ?? [];
  const keywords: string[] = seo.keywords ?? [];

  const variants = p.variants ?? [];
  const variantStock = variants.reduce((s: number, v: any) => s + (v.qty ?? 0), 0);
  const published = p.status === "published";
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const shareUrl = `${siteBase}/shop/${p.category?.slug ?? "all"}/${p.sku}`;
  const photoCount = (p.images ?? []).length;
  const st: any = stats ?? {};

  const product: EditorProduct = {
    sku: p.sku,
    name: p.name,
    categoryId: p.category?.id ?? "",
    categorySlug: p.category?.slug ?? "all",
    type: p.type,
    status: p.status,
    basePriceRupees: Math.round((p.base_wholesale ?? 0) / 100),
    qty: p.qty ?? 0,
    title: gc.title ?? p.name,
    description: gc.description ?? "",
    tags: tags.join("\n"),
    metaTitle: seo.metaTitle ?? "",
    metaDescription: seo.metaDescription ?? "",
    keywords: keywords.join("\n"),
    specs: specsText,
  };

  // ----- Tab panels (server-rendered, handed to the client tab shell) -----

  const basic = (
    <ProductEditor
      product={product}
      categories={categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))}
      formula={{ retailMultiplier: formula.retailMultiplier, mrpMultiplier: formula.mrpMultiplier, wholesaleMarkupPct: formula.wholesaleMarkupPct }}
    />
  );

  const canPrice = can(session, "catalog.price_edit");
  const fSet = computePrices(p.base_wholesale ?? 0, formula);           // formula defaults (paise)
  const prodOv = overridesOf(p);
  const effective = resolvePrices(p.base_wholesale ?? 0, formula, prodOv); // current product-level effective
  const rs = (paise: number) => Math.round(paise / 100);
  const ovVal = (paise: number | null | undefined) => (paise && paise > 0 ? String(rs(paise)) : "");
  const priceInput = "w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  const pricing = (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="font-medium text-ink mb-3">Effective prices</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="rounded-xl bg-cream/60 p-4"><p className="text-xs uppercase tracking-wide text-muted">Wholesale {prodOv.wholesale ? "· custom" : ""}</p><p className="text-2xl font-semibold text-ink mt-1">{formatPaise(effective.wholesaleRate)}</p><p className="text-[11px] text-muted">what retailers pay</p></div>
          <div className="rounded-xl bg-emerald-mist/50 p-4"><p className="text-xs uppercase tracking-wide text-muted">Retail {prodOv.retail ? "· custom" : ""}</p><p className="text-2xl font-semibold text-emerald-dark mt-1">{formatPaise(effective.retailPrice)}</p><p className="text-[11px] text-muted">shop selling price</p></div>
          <div className="rounded-xl bg-gold/10 p-4"><p className="text-xs uppercase tracking-wide text-muted">MRP {prodOv.mrp ? "· custom" : ""}</p><p className="text-2xl font-semibold text-gold-dark mt-1">{formatPaise(effective.mrp)}</p><p className="text-[11px] text-muted">printed price</p></div>
        </div>
      </div>

      {canPrice ? (
        <form action={savePricingAction} className={card}>
          <input type="hidden" name="sku" value={p.sku} />
          <h3 className="font-medium text-ink mb-1">Set prices</h3>
          <p className="text-xs text-muted mb-4">Leave a box blank to use the formula automatically. Enter a ₹ value to pin an exact price. Hierarchy: <b>variant → product → formula</b>.</p>

          <p className="text-xs font-medium text-muted mb-2">Product-level (all ₹)</p>
          <div className="grid sm:grid-cols-3 gap-3 mb-5">
            <label className="text-xs text-muted">Wholesale<input name="p_wholesale" type="number" min={0} step="1" defaultValue={ovVal(prodOv.wholesale)} placeholder={`auto ${rs(fSet.wholesaleRate)}`} className={`${priceInput} mt-1`} /></label>
            <label className="text-xs text-muted">Retail<input name="p_retail" type="number" min={0} step="1" defaultValue={ovVal(prodOv.retail)} placeholder={`auto ${rs(fSet.retailPrice)}`} className={`${priceInput} mt-1`} /></label>
            <label className="text-xs text-muted">MRP<input name="p_mrp" type="number" min={0} step="1" defaultValue={ovVal(prodOv.mrp)} placeholder={`auto ${rs(fSet.mrp)}`} className={`${priceInput} mt-1`} /></label>
          </div>

          {variants.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted mb-2">Per-variant overrides <span className="text-muted/70">(blank = inherit product)</span></p>
              <div className="space-y-2 mb-5">
                {variants.map((v: any) => {
                  const vOv = overridesOf(v);
                  return (
                    <div key={v.id} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-2 items-center">
                      <span className="text-sm text-ink truncate">{v.color ?? v.sku} <span className="text-muted text-xs font-mono">{v.sku}</span></span>
                      <input name={`v_${v.id}_w`} type="number" min={0} step="1" defaultValue={ovVal(vOv.wholesale)} placeholder="W" className={priceInput} aria-label={`${v.sku} wholesale`} />
                      <input name={`v_${v.id}_r`} type="number" min={0} step="1" defaultValue={ovVal(vOv.retail)} placeholder="R" className={priceInput} aria-label={`${v.sku} retail`} />
                      <input name={`v_${v.id}_m`} type="number" min={0} step="1" defaultValue={ovVal(vOv.mrp)} placeholder="MRP" className={priceInput} aria-label={`${v.sku} mrp`} />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <button className="btn-primary px-6 py-2.5 text-sm font-medium">Save prices</button>
        </form>
      ) : (
        <p className="text-sm text-muted">Your role can't edit prices. The base wholesale cost is set on the Basic tab.</p>
      )}
      <p className="text-xs text-muted">Retail &amp; MRP are derived from the base wholesale cost via your pricing formula unless you pin a custom value here.</p>
    </div>
  );

  const inventory = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">In stock</p><p className={`text-2xl font-semibold mt-1 ${p.qty <= 2 ? "text-rose" : "text-ink"}`}>{p.qty}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Variant stock</p><p className="text-2xl font-semibold text-ink mt-1">{variantStock}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Status</p><p className={`text-lg font-semibold mt-1 ${published ? "text-emerald-dark" : "text-gold-dark"}`}>{published ? "Visible" : "Hidden"}</p></div>
      </div>
      {can(session, "inventory.add") || can(session, "inventory.remove")
        ? <ProductStockAdjust sku={p.sku} qty={p.qty ?? 0} variants={variants.map((v: any) => ({ id: v.id, sku: v.sku, color: v.color, qty: v.qty ?? 0 }))} />
        : <p className="text-sm text-muted">Your role can't adjust stock.</p>}
      {variants.length > 0 && (
        <div className={card}>
          <h3 className="font-medium text-ink mb-3">Stock by variant</h3>
          <ul className="divide-y divide-sand/60">
            {variants.map((v: any) => (
              <li key={v.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-ink">{v.color ?? "—"} <span className="text-muted font-mono text-xs">{v.sku}</span></span>
                <span className={`font-medium ${(v.qty ?? 0) <= 2 ? "text-rose" : "text-ink"}`}>{v.qty ?? 0} pcs</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-muted mt-2">The product total ({variantStock}) is the sum of its variants.</p>
        </div>
      )}
      <p className="text-xs text-muted">Every adjustment is logged with a reason and type, and appears in the <b>History</b> tab.</p>
    </div>
  );

  const photos = (
    <div className="space-y-3">
      <MediaCard p={{ id: p.id, sku: p.sku, name: p.name, category: p.category?.name ?? "", images: (p.images ?? []) as any }} geminiReady={geminiConfigured()} />
      {!geminiConfigured() && <p className="text-xs text-gold-dark">Add GEMINI_API_KEY (or OPENAI_API_KEY) to turn raw shots into professional model photos.</p>}
    </div>
  );

  const vInput = "rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald";
  const variantsPanel = (
    <div className={card}>
      {/* Datalists power as-you-type suggestions; typing a brand-new value grows the master list. */}
      <datalist id="opt-color">{vopts.color.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="opt-size">{vopts.size.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="opt-polish">{vopts.polish.map((o) => <option key={o} value={o} />)}</datalist>

      <h3 className="font-medium text-ink mb-1">Variants</h3>
      <p className="text-xs text-muted mb-4">Each variant has its own <b>colour, size &amp; polish</b>, SKU, stock and photos. Variant stock total: <b className="text-ink">{variantStock}</b> pcs. Pick from the suggestions or type a new value — it’s remembered for next time.</p>

      <div className="space-y-4 mb-4">
        {variants.length === 0 && <p className="text-sm text-muted">No variants yet — this is a simple product.</p>}
        {variants.map((v: any) => {
          const imgs: string[] = v.image_paths ?? [];
          return (
            <div key={v.id} className="rounded-xl border border-sand/70 p-3">
              <form action={updateVariantAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="product_sku" value={p.sku} />
                <label className="text-[11px] text-muted">Colour<input name="color" list="opt-color" defaultValue={v.color ?? ""} placeholder="Colour" className={`${vInput} w-28 block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">Size<input name="size" list="opt-size" defaultValue={v.size ?? ""} placeholder="Size" className={`${vInput} w-24 block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">Polish<input name="polish" list="opt-polish" defaultValue={v.polish ?? ""} placeholder="Polish" className={`${vInput} w-28 block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">SKU<input name="sku" defaultValue={v.sku ?? ""} placeholder="auto" className={`${vInput} w-36 block mt-0.5 font-mono`} /></label>
                <label className="text-[11px] text-muted">Stock<input name="qty" type="number" min={0} defaultValue={v.qty ?? 0} className={`${vInput} w-16 text-center block mt-0.5`} /></label>
                <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-xs hover:bg-ink/10">Save</button>
                <button formAction={deleteVariantAction} className="text-muted hover:text-rose text-xs px-1">Delete</button>
              </form>
              {/* Per-variant photos (#12) */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                {imgs.map((u) => (
                  <div key={u} className="relative h-14 w-14 rounded-lg overflow-hidden border border-sand group">
                    <img src={u} alt={v.color ?? v.sku} className="h-full w-full object-cover" />
                    <form action={deleteVariantImageAction} className="absolute top-0 right-0">
                      <input type="hidden" name="id" value={v.id} /><input type="hidden" name="product_sku" value={p.sku} /><input type="hidden" name="url" value={u} />
                      <button className="bg-ink/70 text-white text-[10px] leading-none px-1 py-0.5 rounded-bl" title="Remove photo">✕</button>
                    </form>
                  </div>
                ))}
                <form action={addVariantImageAction} className="flex items-center gap-1.5">
                  <input type="hidden" name="id" value={v.id} /><input type="hidden" name="product_sku" value={p.sku} />
                  <input type="file" name="images" accept="image/*" multiple className="text-[11px] w-36 file:mr-1.5 file:rounded file:border-0 file:bg-emerald-mist file:text-emerald-dark file:px-2 file:py-1 file:text-[11px] file:cursor-pointer" />
                  <button className="px-2.5 py-1.5 rounded-lg bg-emerald text-white text-xs">Add photo</button>
                </form>
              </div>
            </div>
          );
        })}
      </div>

      <form action={addVariantAction} className="flex flex-wrap items-end gap-2 border-t border-sand/60 pt-4">
        <input type="hidden" name="product_sku" value={p.sku} />
        <label className="text-[11px] text-muted">Colour<input name="color" list="opt-color" placeholder="e.g. Green" className={`${vInput} w-28 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Size<input name="size" list="opt-size" placeholder="e.g. 2.6" className={`${vInput} w-24 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Polish<input name="polish" list="opt-polish" placeholder="e.g. Oxidised" className={`${vInput} w-28 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">SKU<input name="sku" placeholder="blank = auto" className={`${vInput} w-36 block mt-0.5 font-mono`} /></label>
        <label className="text-[11px] text-muted">Stock<input name="qty" type="number" min={0} defaultValue={0} className={`${vInput} w-16 text-center block mt-0.5`} /></label>
        <button className="btn-primary px-4 py-2 text-sm font-medium">+ Add variant</button>
      </form>
      <p className="text-[11px] text-muted mt-2">At least one of colour / size / polish is required. Add photos to each variant so the storefront shows the right piece per option.</p>
    </div>
  );

  const catalog = (
    <div className="space-y-4">
      <div className={card}>
        <h3 className="font-medium text-ink mb-3">Storefront visibility</h3>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">{published ? "This product is live on the shop." : "Hidden — customers can't see it yet."}</p>
          {can(session, "catalog.publish") && (
            <form action={setProductVisibilityAction}>
              <input type="hidden" name="sku" value={p.sku} />
              <input type="hidden" name="status" value={published ? "draft" : "published"} />
              <button className="px-4 py-2 rounded-full bg-gold/15 text-gold-dark text-sm hover:bg-gold/25">{published ? "Hide from store" : "Show on store"}</button>
            </form>
          )}
        </div>
        {/* #1 wholesale-only */}
        <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-sand/60">
          <p className="text-sm text-muted">{(p as any).wholesale_only ? "Wholesale only — hidden from the D2C storefront, shown to approved retailers." : "Sold to everyone (retail + wholesale)."}</p>
          <form action={setWholesaleOnlyAction}>
            <input type="hidden" name="sku" value={p.sku} />
            <input type="hidden" name="wholesale_only" value={(p as any).wholesale_only ? "0" : "1"} />
            <button className="px-4 py-2 rounded-full bg-wine/10 text-wine text-sm hover:bg-wine/20 whitespace-nowrap">{(p as any).wholesale_only ? "Make available to all" : "Wholesale only"}</button>
          </form>
        </div>
      </div>

      <div className={card}>
        <h3 className="font-medium text-ink mb-1">Category &amp; subcategory</h3>
        <p className="text-xs text-muted mb-3">Parent: <b className="text-ink">{p.category?.name ?? "—"}</b>. Assign a subcategory so it shows in nested filters and subcategory catalogues.</p>
        <form action={moveProductToSubcategoryAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="sku" value={p.sku} />
          <select name="subcategory_id" defaultValue={(p as any).subcategory_id ?? ""} className="rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald">
            <option value="">— None (parent only) —</option>
            {subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
          {subcategories.length === 0 && <span className="text-xs text-muted">No subcategories under {p.category?.name ?? "this category"} yet — add some in Categories.</span>}
        </form>
      </div>

      <div className={card}>
        <h3 className="font-medium text-ink mb-1">Labels</h3>
        <p className="text-xs text-muted mb-3">Stick your own labels on this product. Create new ones in <Link href="/admin/categories" className="text-emerald nav-link">Categories</Link>.</p>
        {allLabels.length === 0 ? (
          <p className="text-sm text-muted">No labels yet — add some in Categories.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {allLabels.map((l: any) => {
              const on = labelIds.has(l.id);
              return (
                <form key={l.id} action={toggleProductLabelAction}>
                  <input type="hidden" name="sku" value={p.sku} />
                  <input type="hidden" name="label_id" value={l.id} />
                  <input type="hidden" name="on" value={on ? "0" : "1"} />
                  <button className={`inline-flex items-center gap-1 rounded-full text-xs px-3 py-1.5 border transition-all ${on ? `${LABEL_CHIP[l.color] ?? LABEL_CHIP.emerald} border-transparent` : "bg-white text-muted border-sand hover:border-gold"}`}>
                    {on ? "✓ " : "+ "}{l.name}
                  </button>
                </form>
              );
            })}
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-medium text-ink mb-2">Keywords &amp; tags</h3>
        {tags.length + keywords.length === 0
          ? <p className="text-sm text-muted">No tags yet — add them on the Basic tab to help search &amp; filtering.</p>
          : <div className="flex flex-wrap gap-1.5">{[...new Set([...tags, ...keywords])].slice(0, 24).map((t) => <span key={t} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-mist text-emerald-dark">{t}</span>)}</div>}
      </div>

      <div className={card}>
        <h3 className="font-medium text-ink mb-2">Share</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={shareUrl} target="_blank" className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">View live page ↗</Link>
          <a href={`https://wa.me/?text=${encodeURIComponent(`${p.name} — Blythe Diva: ${shareUrl}`)}`} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-full bg-emerald-mist text-emerald-dark text-sm hover:bg-emerald-mist/70">Share on WhatsApp</a>
        </div>
        <p className="text-[11px] text-muted mt-2 break-all">{shareUrl}</p>
      </div>
    </div>
  );

  const historyPanel = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Units sold</p><p className="text-xl font-semibold text-ink mt-1">{st.units ?? 0}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Revenue</p><p className="text-xl font-semibold text-emerald mt-1">{formatPaise(st.revenue ?? 0)}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Orders</p><p className="text-xl font-semibold text-ink mt-1">{st.orders ?? 0}</p></div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Photos</p><p className="text-xl font-semibold text-ink mt-1">{photoCount}</p></div>
      </div>
      <div className={card}>
        <h3 className="font-medium text-ink mb-3">Stock movements</h3>
        {history.length === 0 ? <p className="text-sm text-muted">No stock adjustments recorded yet.</p> : (
          <ul className="divide-y divide-sand/60">
            {history.map((h, i) => (
              <li key={i} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <span className={`font-medium tabular-nums ${h.delta > 0 ? "text-emerald-dark" : "text-rose"}`}>{h.delta > 0 ? "+" : ""}{h.delta}</span>
                <span className="flex-1 text-ink truncate">
                  {h.kind && <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mr-1.5 ${h.kind === "damage" ? "bg-rose/10 text-rose" : h.kind === "purchase" ? "bg-emerald-mist text-emerald-dark" : "bg-cream text-muted"}`}>{h.kind}</span>}
                  {h.source ?? "Adjustment"}{h.reason ? <span className="text-muted"> — {h.reason}</span> : null}
                </span>
                <span className="text-muted whitespace-nowrap">{timeAgo(h.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const tabs: WorkspaceTab[] = [
    { key: "basic", label: "Basic", icon: "📝", node: basic },
    { key: "pricing", label: "Pricing", icon: "₹", node: pricing },
    { key: "inventory", label: "Inventory", icon: "📦", badge: String(p.qty ?? 0), node: inventory },
    { key: "photos", label: "Photos", icon: "📷", badge: String(photoCount), node: photos },
    { key: "variants", label: "Variants", icon: "🎨", badge: String(variants.length), node: variantsPanel },
    { key: "catalog", label: "Catalog", icon: "🏷️", node: catalog },
    { key: "history", label: "History", icon: "🕑", node: historyPanel },
  ];
  const initial = (["basic", "pricing", "inventory", "photos", "variants", "catalog", "history"].includes(searchParams.tab ?? "")
    ? searchParams.tab : "basic") as TabKey;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="mb-5 max-w-4xl">
        <Link href="/admin/catalogue" className="text-sm text-muted hover:text-ink">← Catalogue</Link>
        <div className="flex items-center gap-3 mt-1 flex-wrap">
          <h1 className="font-display text-4xl text-ink">{p.name}</h1>
          <span className={`text-xs px-2 py-0.5 rounded-full ${published ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>{published ? "Visible" : "Hidden"}</span>
        </div>
        <p className="text-sm text-muted">{p.category?.name} · {p.sku} — everything for this product in one place.</p>
      </div>
      <ProductWorkspace tabs={tabs} initial={initial} />
    </main>
  );
}
