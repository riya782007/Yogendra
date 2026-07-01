"use client";
/**
 * ProductManager — the enterprise Product Management (PIM) surface for /admin/products/[id].
 * 9 tabs (General, Pricing, Inventory, Variants, Retail, Wholesale, Media, SEO, History) over a
 * single product, with independent retail/wholesale settings, Formula/Manual price badges, live
 * price preview and client-side validation. Each tab saves through its own server action; all
 * panels stay mounted so unsaved edits survive tab switches.
 */
import { useState } from "react";
import Link from "next/link";
import { formatPaise, computePrices } from "@/lib/pricing";
import {
  saveProductGeneralAction, saveProductInventoryAction, saveProductPricingAction,
  saveProductChannelAction, saveVariantVisibilityAction,
} from "@/app/actions/products";

const TABS = [
  ["general", "General", "📋"], ["pricing", "Pricing", "₹"], ["inventory", "Inventory", "📦"],
  ["variants", "Variants", "🎨"], ["retail", "Retail Storefront", "🛍"], ["wholesale", "Wholesale Storefront", "🏭"],
  ["media", "Media", "🖼"], ["seo", "SEO", "🔎"], ["history", "History", "🕑"],
] as const;
type TabKey = (typeof TABS)[number][0];

const field = "w-full rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
const label = "block text-xs font-medium text-muted mb-1";
const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";
const saveBtn = "px-5 py-2 rounded-xl bg-ink text-white text-sm hover:bg-ink/90";

function Toggle({ name, on, children }: { name: string; on: boolean; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink cursor-pointer py-1">
      <input type="checkbox" name={name} defaultChecked={on} className="w-4 h-4 accent-emerald" />
      {children}
    </label>
  );
}

export function ProductManager({ data, initialTab }: { data: any; initialTab?: string }) {
  const p = data.product;
  const det = data.details ?? {};
  const rc = data.channels?.retail ?? {};
  const wc = data.channels?.wholesale ?? {};
  const [tab, setTab] = useState<TabKey>((TABS.some((t) => t[0] === initialTab) ? initialTab : "general") as TabKey);

  // Pricing preview state (recomputes formula prices as the base cost changes).
  const [baseRupees, setBaseRupees] = useState(((p.base_wholesale ?? 0) / 100).toString());
  const formulaPrices = computePrices(Math.round((Number(baseRupees) || 0) * 100), data.formula);
  const retailManual = p.retail_override != null;
  const wholesaleManual = p.wholesale_override != null;
  const mrpManual = p.mrp_override != null;

  // Client validation warnings.
  const warns: string[] = [];
  const cost = Math.round((Number(baseRupees) || 0) * 100);
  if (data.prices.retailPrice < cost) warns.push("Retail price is below cost.");
  if (data.prices.wholesaleRate > data.prices.retailPrice) warns.push("Wholesale price exceeds retail price.");
  if ((p.qty ?? 0) < 0) warns.push("Inventory is negative.");

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <Link href="/admin/inventory" className="text-sm text-muted hover:text-ink">← Inventory</Link>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full ${p.status === "published" ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>{p.status === "published" ? "Published" : "Hidden"}</span>
          <Link href={`/shop/${p.category?.slug}/${p.sku}`} target="_blank" className="text-xs text-emerald nav-link">view ↗</Link>
        </div>
      </div>
      <h1 className="font-display text-3xl text-ink">{p.name}</h1>
      <p className="text-sm text-muted mb-3">{p.category?.name} · {p.sku} · <span className="capitalize">{p.type}</span></p>

      {warns.length > 0 && (
        <div className="mb-4 rounded-xl border border-gold/50 bg-gold/10 px-4 py-2 text-xs text-ink">
          ⚠ {warns.join("  ·  ")}
        </div>
      )}

      {/* Tab bar */}
      <div role="tablist" className="flex flex-wrap gap-1 mb-5 bg-white/70 backdrop-blur rounded-2xl border border-sand p-1.5 shadow-card sticky top-2 z-10">
        {TABS.map(([key, lbl, icon]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`px-3 py-2 rounded-xl text-sm font-medium flex items-center gap-1.5 ${tab === key ? "bg-ink text-white" : "text-muted hover:text-ink hover:bg-cream"}`}>
            <span aria-hidden>{icon}</span><span className="hidden sm:inline">{lbl}</span>
          </button>
        ))}
      </div>

      {/* ---------- GENERAL ---------- */}
      <div hidden={tab !== "general"}>
        <form action={saveProductGeneralAction} className={card}>
          <input type="hidden" name="id" value={p.id} />
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label className={label}>Product name</label><input name="name" defaultValue={p.name} className={field} required /></div>
            <div><label className={label}>Product code</label><input name="product_code" defaultValue={det.product_code ?? ""} className={field} /></div>
            <div><label className={label}>Internal SKU (unique, scannable)</label><input name="internal_sku" defaultValue={det.internal_sku ?? p.sku} className={`${field} uppercase`} /></div>
            <div><label className={label}>Category</label>
              <select name="category_id" defaultValue={p.category?.id ?? ""} className={field}>
                {data.categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className={label}>Collection</label><input name="collection" defaultValue={det.collection ?? ""} className={field} /></div>
            <div><label className={label}>Brand</label><input name="brand" defaultValue={det.brand ?? ""} className={field} /></div>
            <div><label className={label}>Product type</label>
              <select name="type" defaultValue={p.type} className={field}><option value="simple">Simple (single SKU)</option><option value="configurable">Configurable (variants)</option></select>
            </div>
            <div><label className={label}>Status</label>
              <select name="lifecycle" defaultValue={det.lifecycle ?? (p.status === "published" ? "published" : "draft")} className={field}>
                <option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option><option value="discontinued">Discontinued</option>
              </select>
            </div>
            <div><label className={label}>Vendor</label><input name="vendor" defaultValue={det.vendor ?? ""} className={field} /></div>
            <div><label className={label}>Supplier</label><input name="supplier" defaultValue={det.supplier ?? ""} className={field} /></div>
            <div><label className={label}>Material</label><input name="material" defaultValue={det.material ?? ""} className={field} /></div>
            <div><label className={label}>Occasion</label><input name="occasion" defaultValue={det.occasion ?? ""} className={field} /></div>
            <div><label className={label}>GST %</label><input name="gst_pct" type="number" step="0.01" defaultValue={det.gst_pct ?? ""} className={field} /></div>
            <div><label className={label}>HSN code</label><input name="hsn_code" defaultValue={det.hsn_code ?? ""} className={field} /></div>
            <div><label className={label}>Country of origin</label><input name="country_of_origin" defaultValue={det.country_of_origin ?? "India"} className={field} /></div>
            <div><label className={label}>Weight (g)</label><input name="weight_grams" type="number" step="0.01" defaultValue={det.weight_grams ?? ""} className={field} /></div>
            <div className="sm:col-span-2 grid grid-cols-3 gap-3">
              <div><label className={label}>Length (mm)</label><input name="length_mm" type="number" step="0.1" defaultValue={det.length_mm ?? ""} className={field} /></div>
              <div><label className={label}>Width (mm)</label><input name="width_mm" type="number" step="0.1" defaultValue={det.width_mm ?? ""} className={field} /></div>
              <div><label className={label}>Height (mm)</label><input name="height_mm" type="number" step="0.1" defaultValue={det.height_mm ?? ""} className={field} /></div>
            </div>
            <div className="sm:col-span-2"><label className={label}>Short description</label><input name="short_description" defaultValue={det.short_description ?? ""} className={field} /></div>
          </div>
          <div className="mt-4 flex justify-end"><button className={saveBtn}>Save general</button></div>
        </form>
      </div>

      {/* ---------- PRICING ---------- */}
      <div hidden={tab !== "pricing"}>
        <form action={saveProductPricingAction} className={card}>
          <input type="hidden" name="id" value={p.id} />
          <div><label className={label}>Base cost (₹) — drives every formula price</label>
            <input name="base_price_rupees" value={baseRupees} onChange={(e) => setBaseRupees(e.target.value)} inputMode="decimal" className={`${field} max-w-[200px]`} />
          </div>
          <div className="grid sm:grid-cols-2 gap-5 mt-5">
            <div className="rounded-xl border border-sand p-4">
              <p className="font-medium text-ink mb-2">Retail pricing</p>
              <p className="text-xs text-muted mb-2">Formula price: <b>{formatPaise(formulaPrices.retailPrice)}</b> · MRP {formatPaise(formulaPrices.mrp)}</p>
              <Toggle name="retail_manual" on={retailManual}>Manual override <PriceBadge manual={retailManual} /></Toggle>
              <label className={label}>Final retail price (₹)</label>
              <input name="retail_price_rupees" type="number" step="0.01" defaultValue={retailManual ? (p.retail_override / 100).toFixed(2) : (formulaPrices.retailPrice / 100).toFixed(2)} className={field} />
              <label className={`${label} mt-2`}>MRP (₹)</label>
              <Toggle name="mrp_manual" on={mrpManual}>Manual MRP <PriceBadge manual={mrpManual} /></Toggle>
              <input name="mrp_rupees" type="number" step="0.01" defaultValue={mrpManual ? (p.mrp_override / 100).toFixed(2) : (formulaPrices.mrp / 100).toFixed(2)} className={field} />
              <label className={`${label} mt-2`}>Retail discount %</label>
              <input name="retail_discount_pct" type="number" step="0.01" defaultValue={det.retail_discount_pct ?? ""} className={field} />
            </div>
            <div className="rounded-xl border border-sand p-4">
              <p className="font-medium text-ink mb-2">Wholesale pricing</p>
              <p className="text-xs text-muted mb-2">Formula rate: <b>{formatPaise(formulaPrices.wholesaleRate)}</b></p>
              <Toggle name="wholesale_manual" on={wholesaleManual}>Manual override <PriceBadge manual={wholesaleManual} /></Toggle>
              <label className={label}>Final wholesale price (₹)</label>
              <input name="wholesale_price_rupees" type="number" step="0.01" defaultValue={wholesaleManual ? (p.wholesale_override / 100).toFixed(2) : (formulaPrices.wholesaleRate / 100).toFixed(2)} className={field} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div><label className={label}>MOQ</label><input name="moq" type="number" defaultValue={det.moq ?? ""} className={field} /></div>
                <div><label className={label}>Bulk discount %</label><input name="bulk_discount_pct" type="number" step="0.01" defaultValue={det.bulk_discount_pct ?? ""} className={field} /></div>
                <div><label className={label}>Dealer margin %</label><input name="dealer_margin_pct" type="number" step="0.01" defaultValue={det.dealer_margin_pct ?? ""} className={field} /></div>
                <div><label className={label}>Wholesale tier</label><input name="wholesale_tier" defaultValue={det.wholesale_tier ?? ""} className={field} /></div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end"><button className={saveBtn}>Save pricing</button></div>
        </form>
      </div>

      {/* ---------- INVENTORY ---------- */}
      <div hidden={tab !== "inventory"}>
        <form action={saveProductInventoryAction} className={card}>
          <input type="hidden" name="id" value={p.id} />
          <div className="grid sm:grid-cols-3 gap-4">
            <div><label className={label}>Current quantity</label><input name="qty" type="number" defaultValue={p.qty ?? 0} className={field} /></div>
            <div><label className={label}>Reserved (from estimates)</label><input value={data.reserved} disabled className={`${field} bg-cream/50`} /></div>
            <div><label className={label}>Available</label><input value={data.available} disabled className={`${field} bg-cream/50`} /></div>
            <div><label className={label}>Minimum stock</label><input name="min_stock" type="number" defaultValue={p.min_stock ?? ""} className={field} /></div>
            <div><label className={label}>Maximum stock</label><input name="max_stock" type="number" defaultValue={p.max_stock ?? ""} className={field} /></div>
            <div><label className={label}>Reorder point</label><input name="reorder_level" type="number" defaultValue={p.reorder_level ?? ""} className={field} /></div>
            <div><label className={label}>Warehouse</label><input name="warehouse" defaultValue={p.warehouse ?? ""} className={field} /></div>
            <div className="sm:col-span-2"><label className={label}>Barcode</label><input name="barcode" defaultValue={p.barcode ?? ""} className={field} /></div>
          </div>
          <div className="mt-3 space-y-1">
            <Toggle name="track_inventory" on={p.track_inventory ?? true}>Track inventory</Toggle>
            <Toggle name="continue_selling_oos" on={p.continue_selling_oos ?? false}>Continue selling when out of stock</Toggle>
            <Toggle name="allow_backorders" on={p.allow_backorders ?? false}>Allow backorders</Toggle>
          </div>
          <div className="mt-4 flex justify-end"><button className={saveBtn}>Save inventory</button></div>
        </form>
      </div>

      {/* ---------- VARIANTS ---------- */}
      <div hidden={tab !== "variants"}>
        <div className={card}>
          {p.type !== "configurable" ? (
            <p className="text-sm text-muted">This is a <b>Simple</b> product (single SKU, single inventory). Switch it to <b>Configurable</b> on the General tab to add variants.</p>
          ) : data.variants.length === 0 ? (
            <p className="text-sm text-muted">No variants yet. Add colours/sizes in the <Link href={`/admin/catalogue/${p.sku}?tab=variants`} className="text-emerald nav-link">variant editor →</Link></p>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-center mb-1">
                <p className="text-sm font-medium text-ink">{data.variants.length} variants</p>
                <Link href={`/admin/catalogue/${p.sku}?tab=variants`} className="text-xs text-emerald nav-link">Add / edit / bulk →</Link>
              </div>
              {data.variants.map((v: any) => (
                <div key={v.id} className="rounded-xl border border-sand p-3 flex flex-wrap items-center gap-3 text-sm">
                  <div className="min-w-[140px]">
                    <p className="font-medium text-ink">{v.color ?? v.sku}{v.size ? ` · ${v.size}` : ""}</p>
                    <p className="text-[11px] text-muted font-mono">{v.sku}</p>
                  </div>
                  <span className="text-xs text-muted">Qty {v.qty}</span>
                  <span className="text-xs text-muted">Retail {formatPaise(v.prices.retailPrice)} · WS {formatPaise(v.prices.wholesaleRate)}</span>
                  <div className="ml-auto flex gap-2">
                    <VariantToggle productId={p.id} variantId={v.id} channel="retail" on={v.retailVisible} label="Retail" />
                    <VariantToggle productId={p.id} variantId={v.id} channel="wholesale" on={v.wholesaleVisible} label="Wholesale" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ---------- RETAIL STOREFRONT ---------- */}
      <div hidden={tab !== "retail"}>
        <form action={saveProductChannelAction} className={card}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="channel" value="retail" />
          <p className="text-xs text-muted mb-3">Controls visible only to <b>retail</b> customers. Independent from wholesale.</p>
          <div className="grid sm:grid-cols-2 gap-x-6">
            <Toggle name="visible" on={rc.visible ?? true}>Published (visible)</Toggle>
            <Toggle name="featured" on={rc.featured ?? false}>Featured</Toggle>
            <Toggle name="show_in_search" on={rc.show_in_search ?? true}>Show in search</Toggle>
            <Toggle name="show_in_collections" on={rc.show_in_collections ?? true}>Show in collections</Toggle>
            <Toggle name="allow_reviews" on={rc.allow_reviews ?? true}>Allow reviews</Toggle>
            <Toggle name="allow_wishlist" on={rc.allow_wishlist ?? true}>Allow wishlist</Toggle>
            <Toggle name="show_price" on={rc.show_price ?? true}>Show price</Toggle>
            <Toggle name="show_discount" on={rc.show_discount ?? true}>Show discount</Toggle>
            <Toggle name="show_related" on={rc.show_related ?? true}>Show related products</Toggle>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div className="sm:col-span-2"><label className={label}>Retail description</label><textarea name="description" rows={3} defaultValue={rc.description ?? ""} className={field} /></div>
            <div className="sm:col-span-2"><label className={label}>Retail specifications</label><textarea name="specifications" rows={3} defaultValue={rc.specifications ?? ""} className={`${field} font-mono text-[13px]`} /></div>
            <div><label className={label}>Product badges</label><input name="badges" defaultValue={rc.badges ?? ""} placeholder="Bestseller, New" className={field} /></div>
            <div><label className={label}>Retail URL slug</label><input name="url_slug" defaultValue={rc.url_slug ?? ""} className={field} /></div>
            <div><label className={label}>Retail SEO title</label><input name="seo_title" defaultValue={rc.seo_title ?? ""} className={field} /></div>
            <div><label className={label}>Retail meta description</label><input name="meta_description" defaultValue={rc.meta_description ?? ""} className={field} /></div>
          </div>
          <div className="mt-4 flex justify-end"><button className={saveBtn}>Save retail settings</button></div>
        </form>
      </div>

      {/* ---------- WHOLESALE STOREFRONT ---------- */}
      <div hidden={tab !== "wholesale"}>
        <form action={saveProductChannelAction} className={card}>
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="channel" value="wholesale" />
          <p className="text-xs text-muted mb-3">Controls visible only in the <b>dealer portal</b>. Independent from retail.</p>
          <div className="grid sm:grid-cols-2 gap-x-6">
            <Toggle name="visible" on={wc.visible ?? true}>Published (visible)</Toggle>
            <Toggle name="dealer_only" on={wc.dealer_only ?? false}>Dealer only</Toggle>
            <Toggle name="trade_price_visible" on={wc.trade_price_visible ?? true}>Trade price visible</Toggle>
            <Toggle name="retail_price_hidden" on={wc.retail_price_hidden ?? false}>Hide retail price</Toggle>
          </div>
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div className="sm:col-span-2"><label className={label}>Wholesale description</label><textarea name="description" rows={3} defaultValue={wc.description ?? ""} className={field} /></div>
            <div className="sm:col-span-2"><label className={label}>Trade notes</label><textarea name="trade_notes" rows={2} defaultValue={wc.trade_notes ?? ""} className={field} /></div>
            <div><label className={label}>Dealer tags</label><input name="dealer_tags" defaultValue={wc.dealer_tags ?? ""} className={field} /></div>
            <div><label className={label}>Wholesale collections</label><input name="collections" defaultValue={wc.collections ?? ""} className={field} /></div>
            <div><label className={label}>Wholesale SEO title</label><input name="seo_title" defaultValue={wc.seo_title ?? ""} className={field} /></div>
            <div><label className={label}>Wholesale meta description</label><input name="meta_description" defaultValue={wc.meta_description ?? ""} className={field} /></div>
          </div>
          <div className="mt-4 flex justify-end"><button className={saveBtn}>Save wholesale settings</button></div>
        </form>
      </div>

      {/* ---------- MEDIA ---------- */}
      <div hidden={tab !== "media"}>
        <div className={card}>
          <div className="flex justify-between items-center mb-3">
            <p className="text-sm font-medium text-ink">{data.images.length} image(s)</p>
            <Link href={`/admin/catalogue/${p.sku}?tab=photos`} className="text-xs text-emerald nav-link">Upload / reorder / AI photos →</Link>
          </div>
          {data.images.length === 0 ? (
            <p className="text-sm text-muted">No images yet.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {data.images.map((im: any, i: number) => (
                <div key={im.id ?? i} className="aspect-square rounded-lg overflow-hidden bg-cream border border-sand relative">
                  {typeof im.path === "string" && im.path.startsWith("http") ? <img src={im.path} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[10px] text-muted">{im.kind ?? "img"}</div>}
                  {i === 0 && <span className="absolute top-1 left-1 bg-ink/80 text-cream text-[9px] px-1.5 rounded-full">Primary</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-muted mt-3">Drag-drop reorder, retail/wholesale-only images, 360° &amp; video land in Phase 2; upload + AI photos work today via the link above.</p>
        </div>
      </div>

      {/* ---------- SEO (live preview of the per-channel SEO set above) ---------- */}
      <div hidden={tab !== "seo"}>
        <div className="space-y-4">
          <SeoPreview title={rc.seo_title || p.name} desc={rc.meta_description} slug={rc.url_slug || p.sku} channel="Retail" img={data.images[0]?.path} />
          <SeoPreview title={wc.seo_title || p.name} desc={wc.meta_description} slug={wc.url_slug || p.sku} channel="Wholesale" img={data.images[0]?.path} />
          <p className="text-[11px] text-muted">Edit these fields on the Retail / Wholesale Storefront tabs. JSON-LD + OpenGraph are generated from them.</p>
        </div>
      </div>

      {/* ---------- HISTORY ---------- */}
      <div hidden={tab !== "history"}>
        <div className={card}>
          <p className="text-sm font-medium text-ink mb-3">Audit timeline</p>
          {data.audit.length === 0 ? (
            <p className="text-sm text-muted">No recorded changes yet.</p>
          ) : (
            <ul className="space-y-2">
              {data.audit.map((a: any, i: number) => (
                <li key={i} className="flex items-start gap-3 text-sm border-l-2 border-sand pl-3">
                  <span className="text-[11px] text-muted whitespace-nowrap w-28">{new Date(a.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  <div><span className="text-ink capitalize">{(a.action ?? "").replace(/_/g, " ")}</span>{a.detail ? <span className="text-muted"> — {a.detail}</span> : ""}<span className="text-[11px] text-muted"> · {a.actor ?? "owner"}</span></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function PriceBadge({ manual }: { manual: boolean }) {
  return <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full ${manual ? "bg-gold/15 text-gold-dark" : "bg-emerald-mist text-emerald-dark"}`}>{manual ? "Manual" : "Formula"}</span>;
}

function VariantToggle({ productId, variantId, channel, on, label }: { productId: string; variantId: string; channel: string; on: boolean; label: string }) {
  return (
    <form action={saveVariantVisibilityAction} className="flex items-center gap-1">
      <input type="hidden" name="id" value={productId} />
      <input type="hidden" name="variant_id" value={variantId} />
      <input type="hidden" name="channel" value={channel} />
      <label className="flex items-center gap-1 text-[11px] text-muted cursor-pointer">
        <input type="checkbox" name="visible" defaultChecked={on} className="w-3.5 h-3.5 accent-emerald" />
        {label}
      </label>
      <button className="text-[10px] px-1.5 py-0.5 rounded bg-ink/5 text-ink hover:bg-ink/10">Apply</button>
    </form>
  );
}

function SeoPreview({ title, desc, slug, channel, img }: { title: string; desc?: string | null; slug: string; channel: string; img?: string | null }) {
  return (
    <div className="bg-white rounded-2xl border border-sand p-5 shadow-card">
      <p className="text-xs font-medium text-muted mb-2">{channel} · Google preview</p>
      <div className="mb-3">
        <p className="text-[#1a0dab] text-lg leading-tight truncate">{title}</p>
        <p className="text-[#006621] text-xs">blythediva.com › {slug}</p>
        <p className="text-sm text-ink/70 line-clamp-2">{desc || "No meta description set."}</p>
      </div>
      <p className="text-xs font-medium text-muted mb-1">OpenGraph card</p>
      <div className="flex gap-3 items-center rounded-xl border border-sand p-2">
        <div className="w-16 h-16 rounded-lg bg-cream overflow-hidden shrink-0">{img && img.startsWith("http") ? <img src={img} alt="" className="w-full h-full object-cover" /> : null}</div>
        <div className="min-w-0"><p className="text-sm font-medium text-ink truncate">{title}</p><p className="text-xs text-muted line-clamp-2">{desc || ""}</p></div>
      </div>
    </div>
  );
}
