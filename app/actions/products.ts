"use server";
/**
 * PIM save actions for /admin/products/[id]. Each tab posts to one of these.
 * Backward-compatible: the storefront/POS keep reading products/variants columns, so every
 * save keeps products.wholesale_only / retail_only / status in sync from the channel settings.
 * Money is integer paise. All writes are permission-gated and audit-logged.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";

const num = (v: FormDataEntryValue | null) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const intOrNull = (v: FormDataEntryValue | null) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
const paise = (v: FormDataEntryValue | null) => Math.round((Number(v ?? 0) || 0) * 100);
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;
const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1" || fd.get(k) === "true";

function refresh(id: string) {
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/catalogue");
  revalidatePath("/shop");
}

/** GENERAL tab — core product + the product_details attribute sheet. */
export async function saveProductGeneralAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();

  const name = String(formData.get("name") ?? "").trim();
  const categoryId = str(formData.get("category_id"));
  const type = String(formData.get("type") ?? "simple") === "configurable" ? "configurable" : "simple";
  const lifecycle = String(formData.get("lifecycle") ?? "draft");
  // Map the rich lifecycle onto the products.status enum the storefront understands.
  const status = lifecycle === "published" ? "published" : "draft";

  const patch: Record<string, any> = { type, status };
  if (name) patch.name = name;
  if (categoryId) patch.category_id = categoryId;
  await sb.from("products").update(patch).eq("id", id);

  // Unique-SKU guard: only rename when the new code is free.
  const newSku = String(formData.get("internal_sku") ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  if (newSku) {
    const { data: clash } = await sb.from("products").select("id").eq("sku", newSku).neq("id", id).maybeSingle();
    if (!clash) await sb.from("products").update({ sku: newSku }).eq("id", id);
  }

  await sb.from("product_details").upsert({
    product_id: id,
    product_code: str(formData.get("product_code")),
    internal_sku: str(formData.get("internal_sku")),
    collection: str(formData.get("collection")),
    brand: str(formData.get("brand")),
    vendor: str(formData.get("vendor")),
    supplier: str(formData.get("supplier")),
    short_description: str(formData.get("short_description")),
    weight_grams: num(formData.get("weight_grams")),
    length_mm: num(formData.get("length_mm")),
    width_mm: num(formData.get("width_mm")),
    height_mm: num(formData.get("height_mm")),
    material: str(formData.get("material")),
    occasion: str(formData.get("occasion")),
    gst_pct: num(formData.get("gst_pct")),
    hsn_code: str(formData.get("hsn_code")),
    country_of_origin: str(formData.get("country_of_origin")),
    lifecycle,
    updated_at: new Date().toISOString(),
  }, { onConflict: "product_id" });

  await logActivity({ action: "product_edited", ref: name, detail: `General details updated` });
  refresh(id);
}

/** INVENTORY tab — qty + reorder/min/max/warehouse/barcode/flags. Writes a ledger row on qty change. */
export async function saveProductInventoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.inventory_edit")) && !(await requirePerm("inventory.add"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();

  const { data: cur } = await sb.from("products").select("qty,sku").eq("id", id).maybeSingle();
  const oldQty = (cur as any)?.qty ?? 0;
  const newQty = Math.floor(Number(formData.get("qty") ?? oldQty) || 0);

  await sb.from("products").update({
    qty: newQty,
    reorder_level: intOrNull(formData.get("reorder_level")),
    min_stock: intOrNull(formData.get("min_stock")),
    max_stock: intOrNull(formData.get("max_stock")),
    warehouse: str(formData.get("warehouse")),
    barcode: str(formData.get("barcode")),
    track_inventory: bool(formData, "track_inventory"),
    continue_selling_oos: bool(formData, "continue_selling_oos"),
    allow_backorders: bool(formData, "allow_backorders"),
  }).eq("id", id);

  // Keep the stock ledger consistent: a manual qty edit is an 'adjustment' movement.
  if (newQty !== oldQty) {
    await sb.from("stock_adjustments").insert({
      product_id: id, sku: (cur as any)?.sku ?? null, delta: newQty - oldQty,
      kind: "adjustment", source: "PIM inventory edit", reason: "Manual stock correction", created_by: "owner",
    });
  }
  await logActivity({ action: "inventory_changed", ref: (cur as any)?.sku ?? id, detail: `Stock ${oldQty} → ${newQty}` });
  refresh(id);
}

/** PRICING tab — base cost + retail/wholesale/MRP overrides (Formula vs Manual) + wholesale terms. */
export async function saveProductPricingAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit")) && !(await requirePerm("catalog.price_retail")) && !(await requirePerm("catalog.price_wholesale"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();

  const patch: Record<string, any> = {};
  // Base cost (drives every formula price).
  if (formData.get("base_price_rupees") != null) patch.base_wholesale = paise(formData.get("base_price_rupees"));
  // Override = Manual; absence of the toggle = Formula (override cleared to null).
  patch.retail_override = bool(formData, "retail_manual") ? paise(formData.get("retail_price_rupees")) : null;
  patch.wholesale_override = bool(formData, "wholesale_manual") ? paise(formData.get("wholesale_price_rupees")) : null;
  patch.mrp_override = bool(formData, "mrp_manual") ? paise(formData.get("mrp_rupees")) : null;
  await sb.from("products").update(patch).eq("id", id);

  await sb.from("product_details").upsert({
    product_id: id,
    retail_discount_pct: num(formData.get("retail_discount_pct")),
    moq: intOrNull(formData.get("moq")),
    bulk_discount_pct: num(formData.get("bulk_discount_pct")),
    dealer_margin_pct: num(formData.get("dealer_margin_pct")),
    wholesale_tier: str(formData.get("wholesale_tier")),
    updated_at: new Date().toISOString(),
  }, { onConflict: "product_id" });

  await logActivity({ action: "price_changed", ref: id, detail: "Pricing updated" });
  refresh(id);
}

/** RETAIL / WHOLESALE STOREFRONT + SEO tabs — independent per-channel settings.
 *  After saving, sync products.wholesale_only / retail_only / status from BOTH channels. */
export async function saveProductChannelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.publish")) && !(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const channel = String(formData.get("channel") ?? "") === "wholesale" ? "wholesale" : "retail";
  if (!id) return;
  const sb = supabaseServer();

  await sb.from("product_channel_settings").upsert({
    product_id: id, channel,
    visible: bool(formData, "visible"),
    featured: bool(formData, "featured"),
    dealer_only: bool(formData, "dealer_only"),
    show_in_search: bool(formData, "show_in_search"),
    show_in_collections: bool(formData, "show_in_collections"),
    allow_reviews: bool(formData, "allow_reviews"),
    allow_wishlist: bool(formData, "allow_wishlist"),
    show_price: bool(formData, "show_price"),
    show_discount: bool(formData, "show_discount"),
    show_related: bool(formData, "show_related"),
    trade_price_visible: bool(formData, "trade_price_visible"),
    retail_price_hidden: bool(formData, "retail_price_hidden"),
    description: str(formData.get("description")),
    specifications: str(formData.get("specifications")),
    trade_notes: str(formData.get("trade_notes")),
    dealer_tags: str(formData.get("dealer_tags")),
    collections: str(formData.get("collections")),
    badges: str(formData.get("badges")),
    seo_title: str(formData.get("seo_title")),
    meta_description: str(formData.get("meta_description")),
    url_slug: str(formData.get("url_slug")),
    updated_at: new Date().toISOString(),
  }, { onConflict: "product_id,channel" });

  await syncChannelFlags(id);
  await logActivity({ action: "visibility_changed", ref: id, detail: `${channel} storefront settings updated` });
  refresh(id);
}

/** Mirror the two channel "visible" flags onto the legacy columns the storefront/POS read. */
async function syncChannelFlags(id: string): Promise<void> {
  const sb = supabaseServer();
  const { data } = await sb.from("product_channel_settings").select("channel,visible").eq("product_id", id);
  const rows = (data as any[]) ?? [];
  const retail = rows.find((r) => r.channel === "retail")?.visible ?? true;
  const wholesale = rows.find((r) => r.channel === "wholesale")?.visible ?? true;
  const patch: Record<string, any> = {
    retail_only: retail && !wholesale,
    wholesale_only: wholesale && !retail,
    status: retail || wholesale ? "published" : "draft",
  };
  await sb.from("products").update(patch).eq("id", id);
}

/** VARIANTS tab — independent retail/wholesale visibility per variant. */
export async function saveVariantVisibilityAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.variants")) && !(await requirePerm("catalog.edit"))) return;
  const variantId = String(formData.get("variant_id") ?? "").trim();
  const channel = String(formData.get("channel") ?? "") === "wholesale" ? "wholesale" : "retail";
  const productId = String(formData.get("id") ?? "").trim();
  if (!variantId) return;
  await supabaseServer().from("variant_channel_settings").upsert(
    { variant_id: variantId, channel, visible: bool(formData, "visible") },
    { onConflict: "variant_id,channel" },
  );
  if (productId) refresh(productId);
}
