export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ProductHistoryLedger } from "@/components/admin/ProductHistoryLedger";
import {
  getProductBySku, getCategories, getPricingFormula, getSubcategories, getStyles,
  getProductSalesStats, getStockHistory, getProductEstimates, getVariantOptions, getLabels, getColorCodeMap,
  getLastPurchaseCosts,
} from "@/lib/supabase/queries";
import { ProductEditor, type EditorProduct } from "@/components/admin/ProductEditor";
import { resolveProductContent } from "@/lib/content";
import { ProductWorkspace, type WorkspaceTab, type TabKey } from "@/components/admin/ProductWorkspace";
import { ProductStockAdjust } from "@/components/admin/ProductStockAdjust";
import { MediaCard } from "@/components/admin/MediaCard";
import VariantAiPhoto from "@/components/admin/VariantAiPhoto";
import { requirePerm, getSession, can } from "@/lib/auth";
import { addVariantAction, updateVariantAction, deleteVariantAction } from "@/app/actions/variants";
import { VariantPhotos } from "@/components/admin/VariantPhotos";
import { setProductVisibilityAction, moveProductToSubcategoryAction, moveProductToStyleAction, savePricingAction, setWholesaleOnlyAction, setHideOosVariantsAction, toggleProductLabelAction, setDefaultVariantFormAction } from "@/app/actions/catalog";

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

export default async function ProductPage({ params, searchParams }: { params: { sku: string }; searchParams: { tab?: string; ret?: string } }) {
  // Return the "← Catalogue" arrow to the exact page/filters the owner came from (only trust internal
  // catalogue URLs), so a save-and-back never dumps him on page 1.
  const backHref = (searchParams.ret && /^\/admin\/catalogue(\?|$)/.test(searchParams.ret)) ? searchParams.ret : "/admin/catalogue";
  if (!(await requirePerm("catalog.edit"))) redirect("/admin/dashboard?denied=editing+products");

  const [p, categories, formula] = await Promise.all([
    getProductBySku(params.sku),
    getCategories(),
    getPricingFormula(),
  ]);
  if (!p) notFound();

  const [subcategories, styles, stats, history, vopts, allLabels, colorCodes, estReservations] = await Promise.all([
    getSubcategories({ categoryId: p.category?.id }),
    getStyles({ categoryId: p.category?.id }).catch(() => []),
    getProductSalesStats(p.sku).catch(() => null),
    getStockHistory(p.id).catch(() => []),
    getVariantOptions().catch(() => ({ color: [], size: [], polish: [] })),
    getLabels().catch(() => []),
    getColorCodeMap().catch(() => ({} as Record<string, string>)),
    getProductEstimates(p.id).catch(() => []),
  ]);
  // Last price this piece was actually bought at (display-only, for the owner's margin reference).
  const lastCosts: { byProduct: Record<string, number>; byVariant: Record<string, number> } =
    await getLastPurchaseCosts().catch(() => ({ byProduct: {}, byVariant: {} }));
  const lastCostPaise: number | undefined = lastCosts.byProduct[p.id]
    ?? (p.variants ?? []).map((v: any) => lastCosts.byVariant[v.id]).find((c: number | undefined) => typeof c === "number");
  const labelIds = new Set((((p as any).product_labels as any[]) ?? []).map((x) => x.label_id));

  const session = getSession();
  // Show EXACTLY what the storefront resolves: clean curated title, description/SEO with the old flowery
  // name swapped out, and the house-template used to fill any field the saved content left empty — so the
  // editor never opens blank ("yeh sab khali") and the description never shows the old name. Saving
  // persists these into generated_content.
  const resolved = resolveProductContent({
    name: p.name, sku: p.sku, categoryName: p.category?.name, subcategoryName: (p as any).subcategory?.name,
    colors: ((p.variants ?? []) as any[]).map((v) => v.color).filter(Boolean),
    generated_content: p.generated_content as any,
  });
  const seo = resolved.seo;
  const specsText = Object.entries(resolved.specs).map(([k, v]) => `${k}: ${v}`).join("\n");
  const tags: string[] = resolved.tags;
  const keywords: string[] = resolved.seo.keywords ?? [];

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
    // Visibility/labels surface the same data the dedicated Catalog tab toggles
    // already control, so the unified ProductEditor form opens prefilled.
    visibility: (p as any).retail_only ? "retail" : (p as any).wholesale_only ? "wholesale" : "all",
    labels: (allLabels as any[])
      .filter((l) => labelIds.has(l.id))
      .map((l) => l.name)
      .join(", "),
    basePriceRupees: Math.round((p.base_wholesale ?? 0) / 100),
    // Configurable products carry their stock on the variants — show the live sum, not the (possibly
    // stale) product-row qty, so the read-only Basic-tab total always matches the Variants tab.
    qty: p.type === "configurable" ? variantStock : (p.qty ?? 0),
    title: resolved.title,
    description: resolved.description,
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
      formula={formula}
      effective={(() => {
        const eff = resolvePrices(p.base_wholesale ?? 0, formula, overridesOf(p));
        return {
          retail: Math.round(eff.retailPrice / 100),
          mrp: Math.round(eff.mrp / 100),
          wholesale: Math.round(eff.wholesaleRate / 100),
          custom: !!((p as any).wholesale_override || (p as any).retail_override || (p as any).mrp_override),
        };
      })()}
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
        {/* Last purchase cost — display only, so the owner can see margin at a glance. */}
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-ink/5 px-4 py-2.5 text-sm">
          <span className="text-xs uppercase tracking-wide text-muted">Last purchase cost</span>
          {typeof lastCostPaise === "number"
            ? <><span className="font-semibold text-ink">{formatPaise(lastCostPaise)}</span><span className="text-[11px] text-muted">what you last bought this at</span></>
            : <span className="text-muted">No purchase recorded yet — record one under Purchases.</span>}
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
      <div className="grid grid-cols-2 gap-3">
        {/* One stock figure only: for a product WITH variants the total IS the sum of its variants,
            so we show a single "Total stock" card instead of the confusing duplicate (owner's note). */}
        <div className={card}>
          <p className="text-xs uppercase tracking-wide text-muted">{variants.length > 0 ? "Total stock (all variants)" : "In stock"}</p>
          <p className={`text-2xl font-semibold mt-1 ${(variants.length > 0 ? variantStock : p.qty) <= 2 ? "text-rose" : "text-ink"}`}>{variants.length > 0 ? variantStock : p.qty}</p>
        </div>
        <div className={card}><p className="text-xs uppercase tracking-wide text-muted">Status</p><p className={`text-lg font-semibold mt-1 ${published ? "text-emerald-dark" : "text-gold-dark"}`}>{published ? "Visible" : "Hidden"}</p></div>
      </div>
      {can(session, "inventory.add") || can(session, "inventory.remove")
        ? <ProductStockAdjust sku={p.sku} qty={p.qty ?? 0} variants={variants.map((v: any) => ({ id: v.id, sku: v.sku, color: v.color, qty: v.qty ?? 0 }))} />
        : <p className="text-sm text-muted">Your role can't adjust stock.</p>}
      {variants.length > 0 && (() => {
        // Split in-stock from out-of-stock so the owner sees live colours first and the dead ones
        // tucked into a collapsible "Out of stock" group he can ignore (each marked with a black dot).
        const oosRow = (v: any, dim: boolean) => (
          <li key={v.id} className={`py-2 flex items-center justify-between text-sm ${dim ? "opacity-70" : ""}`}>
            <span className="text-ink flex items-center gap-2">
              {dim && <span className="h-2 w-2 rounded-full bg-ink inline-block shrink-0" title="Out of stock" />}
              <span>{v.color ?? "—"} <span className="text-muted font-mono text-xs">{v.sku}</span></span>
            </span>
            <span className={`font-medium ${(v.qty ?? 0) <= 0 ? "text-muted" : (v.qty ?? 0) <= 2 ? "text-rose" : "text-ink"}`}>{(v.qty ?? 0) <= 0 ? "Out of stock" : `${v.qty} pcs`}</span>
          </li>
        );
        const inStock = variants.filter((v: any) => (v.qty ?? 0) > 0);
        const oos = variants.filter((v: any) => (v.qty ?? 0) <= 0);
        return (
        <div className={card}>
          <h3 className="font-medium text-ink mb-3">Stock by variant <span className="text-xs font-normal text-muted">· {inStock.length} in stock{oos.length ? ` · ${oos.length} out` : ""}</span></h3>
          <ul className="divide-y divide-sand/60">
            {inStock.map((v: any) => oosRow(v, false))}
            {inStock.length === 0 && <li className="py-2 text-sm text-muted">No colours in stock right now.</li>}
          </ul>
          {oos.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-ink flex items-center gap-2 select-none">
                <span className="h-2 w-2 rounded-full bg-ink inline-block" />
                Out of stock ({oos.length}) <span className="text-muted text-xs font-normal">— tap to expand</span>
              </summary>
              <ul className="divide-y divide-sand/60 mt-2">{oos.map((v: any) => oosRow(v, true))}</ul>
            </details>
          )}
          <p className="text-[11px] text-muted mt-2">The product total ({variantStock}) is the sum of its variants.</p>
        </div>
        );
      })()}
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

      <div className="flex items-center justify-between gap-3 mb-1">
        <h3 className="font-medium text-ink">Variants</h3>
        {can(session, "catalog.ai") && (
          <Link href={`/admin/media/${(p as any).id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ink text-white text-xs hover:bg-ink/90">✦ Open AI Studio</Link>
        )}
      </div>
      <p className="text-xs text-muted mb-4">Each variant has its own <b>colour, size &amp; polish</b>, SKU, stock and photos. Variant stock total: <b className="text-ink">{variantStock}</b> pcs. Generate a <b>model photo + a branded on-stand photo per colour</b> in the <Link href={`/admin/media/${(p as any).id}`} className="text-emerald nav-link">AI Studio →</Link>. SKUs auto-generate as <code className="bg-cream px-1 rounded">{`${p.sku}-{colourCode}`}</code> — see your <Link href="/admin/colours" className="text-emerald nav-link">Colours master</Link> for the codes.</p>

      <div className="space-y-4 mb-4">
        {variants.length === 0 && <p className="text-sm text-muted">No variants yet — this is a simple product.</p>}
        {variants.map((v: any) => {
          const imgs: string[] = v.image_paths ?? [];
          // Pillar 11 — what the canonical SKU WOULD be (if the owner clears the SKU
          // field and saves). Shown below the row when it differs from the stored SKU,
          // so the owner can spot variants printing the legacy 5-char truncation and
          // normalise them in one click.
          const canonicalColorCode = v.color ? (colorCodes[String(v.color).toLowerCase()] ?? null) : null;
          const canonicalSku = canonicalColorCode
            ? `${p.sku}-${[canonicalColorCode,
                v.size ? String(v.size).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null,
                v.polish ? String(v.polish).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null,
              ].filter(Boolean).join("-")}`
            : null;
          const needsNormalise = !!canonicalSku && canonicalSku !== v.sku;
          const isDefault = (p as any).default_variant_id === v.id;
          const isOos = (v.qty ?? 0) <= 0;
          return (
            <div key={v.id} className={`rounded-xl border p-3 ${isDefault ? "border-gold bg-gold/5" : isOos ? "border-sand bg-ink/[0.03]" : "border-sand/70"}`}>
              {/* DEFAULT VARIANT — which colour customers see FIRST on the storefront (pre-selected,
                  its photo leads the gallery). One star per product; tap to move it. */}
              <form action={setDefaultVariantFormAction} className="inline-flex items-center gap-1.5 mb-1.5">
                <input type="hidden" name="product_id" value={(p as any).id} />
                <input type="hidden" name="variant_id" value={isDefault ? "" : v.id} />
                <input type="hidden" name="sku" value={p.sku} />
                <button title={isDefault ? "This colour opens first on the storefront (tap to clear)" : "Make this the colour customers see first on the storefront"}
                  className={`text-base leading-none ${isDefault ? "text-gold-dark" : "text-sand hover:text-gold-dark"}`}>★</button>
                <span className={`text-[10px] ${isDefault ? "text-gold-dark font-medium" : "text-muted"}`}>{isDefault ? "Default on storefront" : "Set as storefront default"}</span>
              </form>
              {isOos && (
                <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-medium text-ink bg-ink/5 border border-sand rounded-full px-2 py-0.5 align-middle">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink inline-block" /> Out of stock
                </span>
              )}
              <form action={updateVariantAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={v.id} />
                <input type="hidden" name="product_sku" value={p.sku} />
                <label className="text-[11px] text-muted">Colour<input name="color" list="opt-color" defaultValue={v.color ?? ""} placeholder="Colour" className={`${vInput} w-28 block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">Size<input name="size" list="opt-size" defaultValue={v.size ?? ""} placeholder="Size" className={`${vInput} w-24 block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">Polish<input name="polish" list="opt-polish" defaultValue={v.polish ?? ""} placeholder="Polish" className={`${vInput} w-28 block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">SKU<input name="sku" defaultValue={v.sku ?? ""} placeholder="auto" className={`${vInput} w-32 block mt-0.5 font-mono`} /></label>
                <label className="text-[11px] text-muted">Stock<input name="qty" type="number" min={0} defaultValue={v.qty ?? 0} className={`${vInput} w-14 text-center block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">Retail ₹<input name="retail" type="number" min={0} step="0.01" defaultValue={v.retail_override != null ? (v.retail_override / 100).toFixed(2) : ""} placeholder="auto" className={`${vInput} w-20 text-right block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">Wholesale ₹<input name="wholesale" type="number" min={0} step="0.01" defaultValue={v.wholesale_override != null ? (v.wholesale_override / 100).toFixed(2) : ""} placeholder="auto" className={`${vInput} w-20 text-right block mt-0.5`} /></label>
                <label className="text-[11px] text-muted">MRP ₹<input name="mrp" type="number" min={0} step="0.01" defaultValue={v.mrp_override != null ? (v.mrp_override / 100).toFixed(2) : ""} placeholder="auto" className={`${vInput} w-20 text-right block mt-0.5`} /></label>
                <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-xs hover:bg-ink/10">Save</button>
                <button formAction={deleteVariantAction} className="text-muted hover:text-rose text-xs px-1">Delete</button>
              </form>
              {/* Per-variant photos (#16) — reliable client uploader (compress + feedback, fixes large/HEIC) */}
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <VariantPhotos variantId={v.id} productSku={p.sku} color={v.color ?? null} images={imgs} />
                {can(session, "catalog.ai") && <VariantAiPhoto variantId={v.id} color={v.color ?? null} size={v.size ?? null} polish={v.polish ?? null} />}
              </div>
              {/* Pillar 11 — canonical-SKU hint. If the stored SKU is from the old
                  5-char-truncation era, show the canonical form the system would now
                  generate, so the owner can clear the SKU field above and save to align it. */}
              {needsNormalise && (
                <p className="mt-2 text-[11px] text-gold-dark">
                  Tip: this variant prints <span className="font-mono">{v.sku}</span>; the canonical barcode would be{" "}
                  <span className="font-mono text-ink">{canonicalSku}</span> — clear the SKU field and Save to switch.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <form action={addVariantAction} className="flex flex-wrap items-end gap-2 border-t border-sand/60 pt-4">
        <input type="hidden" name="product_sku" value={p.sku} />
        <label className="text-[11px] text-muted">Colour<input name="color" list="opt-color" placeholder="e.g. Green" className={`${vInput} w-28 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Size<input name="size" list="opt-size" placeholder="e.g. 2.6" className={`${vInput} w-24 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Polish<input name="polish" list="opt-polish" placeholder="e.g. Oxidised" className={`${vInput} w-28 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">SKU<input name="sku" placeholder="blank = auto" className={`${vInput} w-32 block mt-0.5 font-mono`} /></label>
        <label className="text-[11px] text-muted">Stock<input name="qty" type="number" min={0} defaultValue={0} className={`${vInput} w-14 text-center block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Retail ₹<input name="retail" type="number" min={0} step="0.01" placeholder="auto" className={`${vInput} w-20 text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Wholesale ₹<input name="wholesale" type="number" min={0} step="0.01" placeholder="auto" className={`${vInput} w-20 text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">MRP ₹<input name="mrp" type="number" min={0} step="0.01" placeholder="auto" className={`${vInput} w-20 text-right block mt-0.5`} /></label>
        <button className="btn-primary px-4 py-2 text-sm font-medium">+ Add variant</button>
      </form>
      <p className="text-[11px] text-muted mt-2">At least one of colour / size / polish is required. Leave a price <b>blank</b> to use the automatic formula price; enter a value to set that colour&apos;s own retail / wholesale / MRP. Add photos so the storefront shows the right piece per option.</p>
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
        {/* Hide out-of-stock colours from the storefront — the owner's requested control, on the page he actually uses. */}
        {variants.length > 0 && (
          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-sand/60">
            <p className="text-sm text-muted">{(p as any).hide_oos_variants ? "Out-of-stock colours are hidden from customers (shown again automatically when restocked)." : "Out-of-stock colours are shown to customers as “Out of stock”."}</p>
            <form action={setHideOosVariantsAction}>
              <input type="hidden" name="sku" value={p.sku} />
              <input type="hidden" name="hide_oos_variants" value={(p as any).hide_oos_variants ? "0" : "1"} />
              <button className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10 whitespace-nowrap">{(p as any).hide_oos_variants ? "Show out-of-stock colours" : "Hide out-of-stock colours"}</button>
            </form>
          </div>
        )}
      </div>

      <div className={card}>
        <h3 className="font-medium text-ink mb-1">Category &amp; subcategory</h3>
        <p className="text-xs text-muted mb-3">Parent: <b className="text-ink">{p.category?.name ?? "—"}</b>. Assign a subcategory so it shows in nested filters and subcategory catalogues.</p>
        <form action={moveProductToSubcategoryAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="sku" value={p.sku} />
          <span className="text-xs text-muted">Type</span>
          <select name="subcategory_id" defaultValue={(p as any).subcategory_id ?? ""} className="rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald">
            <option value="">— None (parent only) —</option>
            {subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
          {subcategories.length === 0 && <span className="text-xs text-muted">No subcategories under {p.category?.name ?? "this category"} yet — add some in Categories.</span>}
        </form>
        {/* Style — the 2nd filter dimension (Choker, Long Necklace…). */}
        <form action={moveProductToStyleAction} className="flex flex-wrap items-center gap-2 mt-2">
          <input type="hidden" name="sku" value={p.sku} />
          <span className="text-xs text-muted">Style</span>
          <select name="style_id" defaultValue={(p as any).style_id ?? ""} className="rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald">
            <option value="">— No style —</option>
            {styles.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Save</button>
          {styles.length === 0 && <span className="text-xs text-muted">No styles under {p.category?.name ?? "this category"} yet — add some in Categories.</span>}
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
        {/* Shared movement history (same engine as the Stock Ledger drawer): every sale, purchase,
            adjustment AND estimate — each with date, party, VARIANT COLOUR, qty, unit price and its
            bill/estimate link. Replaces the old plain list that showed none of that. */}
        <ProductHistoryLedger productId={p.id} />
      </div>
      {estReservations.length > 0 && (
        <div className={card}>
          <h3 className="font-medium text-ink mb-1">🔖 Estimates (quotes) for this product</h3>
          <p className="text-xs text-muted mb-3">Every quote raised for this piece — with date, party, variant &amp; price. Open estimates soft-hold stock; converted/billed ones have become sales. Click to open the estimate.</p>
          <ul className="divide-y divide-sand/60">
            {estReservations.map((e, i) => (
              <li key={e.id + "-" + i} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Link href={`/admin/estimate/${e.id}`} className="text-emerald nav-link whitespace-nowrap">EST-{String(e.id).slice(0, 8).toUpperCase()} →</Link>
                <span className="text-ink truncate">{e.customer || "Walk-in"}{e.variant ? <span className="text-muted"> · {e.variant}</span> : null}</span>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${e.status === "open" ? "bg-gold/15 text-gold-dark" : "bg-emerald-mist text-emerald-dark"}`}>{e.status}</span>
                <span className="ml-auto text-ink whitespace-nowrap tabular-nums">{e.qty} pcs · {formatPaise(e.lineTotal)}</span>
                <span className="text-muted whitespace-nowrap">{timeAgo(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
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
        <Link href={backHref} className="text-sm text-muted hover:text-ink">← Catalogue</Link>
        <div className="flex items-start justify-between gap-3 mt-1 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="font-display text-4xl text-ink">{p.name}</h1>
              <span className={`text-xs px-2 py-0.5 rounded-full ${published ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>{published ? "Visible" : "Hidden"}</span>
            </div>
            <p className="text-sm text-muted mt-1">{p.category?.name} · {p.sku} — everything for this product in one place.</p>
          </div>
          {/* Prominent one-click Publish / Unpublish — no need to dig into the Catalog tab. */}
          {can(session, "catalog.publish") && (
            <form action={setProductVisibilityAction} className="shrink-0">
              <input type="hidden" name="sku" value={p.sku} />
              <input type="hidden" name="status" value={published ? "draft" : "published"} />
              <button className={`px-5 py-2.5 rounded-full text-sm font-semibold shadow-card transition-colors ${published ? "bg-cream text-ink border border-sand hover:bg-sand/40" : "bg-emerald text-white hover:bg-emerald-dark"}`}>
                {published ? "● Live — Unpublish" : "🚀 Publish to store"}
              </button>
            </form>
          )}
        </div>
      </div>
      <ProductWorkspace tabs={tabs} initial={initial} />
    </main>
  );
}
