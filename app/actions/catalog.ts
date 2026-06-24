"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computePrices, isValidPriceSet } from "@/lib/pricing";
import { getPricingFormula } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function createCategoryAction(formData: FormData) {
  if (!(await requirePerm("catalog.edit"))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const sb = supabaseServer();
  await sb.from("categories").insert({ name, slug: slugify(name) });
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
}

/** Delete a category — only when it has no products (to avoid orphaning the catalogue). */
export async function deleteCategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  const { count } = await sb.from("products").select("id", { count: "exact", head: true }).eq("category_id", id);
  if ((count ?? 0) > 0) return; // refuse to delete a non-empty category
  await sb.from("categories").delete().eq("id", id);
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

async function nextSku(sb: ReturnType<typeof supabaseServer>): Promise<number> {
  const { data } = await sb.from("products").select("sku");
  const max = Math.max(999, ...((data ?? []).map((r: any) => parseInt(String(r.sku).replace(/\D/g, ""), 10) || 0)));
  return max + 1;
}

export type NewProduct = { categoryId: string; name: string; basePriceRupees: number; qty: number; type: "simple" | "configurable"; colors: string[]; manualSku?: string };
export type RowResult = { row: number; ok: boolean; sku?: string; error?: string };

async function insertOne(sb: ReturnType<typeof supabaseServer>, formula: any, n: NewProduct, skuNum: number, publish = false): Promise<RowResult> {
  if (!n.name) return { row: skuNum, ok: false, error: "Missing name" };
  if (!(n.basePriceRupees > 0)) return { row: skuNum, ok: false, error: "Base price must be > 0" };
  if (!n.categoryId) return { row: skuNum, ok: false, error: "Missing category" };
  const prices = computePrices(n.basePriceRupees * 100, formula);
  if (!isValidPriceSet(prices)) return { row: skuNum, ok: false, error: "Computed price invalid — flagged" };
  // Use a manually-entered SKU if provided, else auto-generate BD####.
  const manual = n.manualSku?.trim().toUpperCase().replace(/\s+/g, "-");
  const sku = manual || `BD${skuNum}`;
  if (manual) {
    const { data: dup } = await sb.from("products").select("id").eq("sku", manual).maybeSingle();
    if (dup) return { row: skuNum, ok: false, error: `SKU ${manual} already exists` };
  }
  // Incomplete products (no photo yet) stay DRAFT so they never appear on the storefront
  // looking unfinished. They publish automatically once a photo is added, or via Show.
  const { data: prod, error } = await sb.from("products").insert({
    category_id: n.categoryId, sku, name: n.name, type: n.type,
    base_wholesale: n.basePriceRupees * 100, qty: Math.max(0, n.qty), status: publish ? "published" : "draft", last_movement_at: new Date().toISOString(),
  }).select("id").single();
  if (error) return { row: skuNum, ok: false, error: error.message };
  if (n.type === "configurable" && n.colors.length) {
    await sb.from("variants").insert(n.colors.map((c, i) => ({
      product_id: prod!.id, color: c, sku: `${sku}-${c.slice(0, 3).toUpperCase()}`, qty: Math.floor(n.qty / Math.max(1, n.colors.length)),
    })));
  }
  return { row: skuNum, ok: true, sku };
}

export async function createProductAction(p: NewProduct): Promise<RowResult> {
  if (!(await requirePerm("catalog.create"))) return { row: 0, ok: false, error: "Your role can't add products." };
  const sb = supabaseServer();
  const [formula, sku] = await Promise.all([getPricingFormula(), nextSku(sb)]);
  const res = await insertOne(sb, formula, p, sku);
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return res;
}

export async function bulkUploadAction(categoryId: string, rows: Omit<NewProduct, "categoryId">[]): Promise<{ created: number; results: RowResult[] }> {
  if (!(await requirePerm("catalog.create"))) return { created: 0, results: [{ row: 0, ok: false, error: "Your role can't add products." }] };
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  let skuNum = await nextSku(sb);
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const res = await insertOne(sb, formula, { ...r, categoryId }, skuNum);
    results.push({ ...res, row: i + 1 });
    if (res.ok) skuNum++;
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { created: results.filter((r) => r.ok).length, results };
}

const BUCKET = "product-media";
async function ensureMediaBucket(sb: ReturnType<typeof supabaseServer>) {
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
}

export async function createProductWithImageAction(formData: FormData): Promise<RowResult> {
  if (!(await requirePerm("catalog.create"))) return { row: 0, ok: false, error: "Your role can't add products." };
  const sb = supabaseServer();
  const n: NewProduct = {
    categoryId: String(formData.get("categoryId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    basePriceRupees: Number(formData.get("price")) || 0,
    qty: Number(formData.get("qty")) || 0,
    type: String(formData.get("type")) === "configurable" ? "configurable" : "simple",
    colors: String(formData.get("colors") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    manualSku: String(formData.get("sku") ?? "").trim() || undefined,
  };
  const [formula, skuNum] = await Promise.all([getPricingFormula(), nextSku(sb)]);
  const file = formData.get("image") as File | null;
  const hasPhoto = !!(file && typeof file === "object" && file.size > 0);
  // Publish immediately only when a photo is attached (complete listing); otherwise draft.
  const res = await insertOne(sb, formula, n, skuNum, hasPhoto);
  if (res.ok && res.sku && hasPhoto && file) {
    await ensureMediaBucket(sb);
    const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
    const path = `${res.sku}/source.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
    if (!up.error) {
      const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
      const { data: prod } = await sb.from("products").select("id").eq("sku", res.sku).single();
      if (prod) await sb.from("product_images").insert({ product_id: prod.id, path: pub.publicUrl, kind: "flatlay", sort: 0 });
    }
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return res;
}

// ---- Live-progress inventory build: parse first, then insert one row at a time ----
export type ParsedRow = Omit<NewProduct, "categoryId">;

/** AI/naive parse a messy list into clean rows WITHOUT inserting (so the client can show progress). */
export async function aiParseRowsAction(rawText: string): Promise<{ rows: ParsedRow[]; usedAi: boolean }> {
  if (!(await requirePerm("catalog.create"))) return { rows: [], usedAi: false };
  const text = (rawText ?? "").trim().slice(0, 8000);
  let rows: ParsedRow[] = [];
  let usedAi = false;
  if (text && (groqConfigured() || openaiConfigured())) {
    const system = `You convert a messy product list into clean JSON for a jewellery store. Output STRICT JSON: {"rows":[{"name":string,"base_price":number,"qty":number,"type":"simple"|"configurable","colors":string[]}]}. The input may be CSV, tab-separated, or freeform, with columns in any order or with different header names (price/cost/wholesale -> base_price in rupees as a number; quantity/stock/pcs -> qty integer; colours/variants -> colors array; if multiple colours are present set type to "configurable" else "simple"). Ignore header rows and currency symbols. Infer sensibly. Return ONLY JSON.`;
    try {
      const out = groqConfigured() ? await groqChat({ system, user: text, json: true }) : await openaiChat({ system, user: text, json: true });
      const parsed = JSON.parse(out);
      rows = (parsed.rows ?? []).map((r: any) => ({
        name: String(r.name ?? "").trim(),
        basePriceRupees: Number(r.base_price) || 0,
        qty: parseInt(r.qty, 10) || 0,
        type: (r.type === "configurable" || (Array.isArray(r.colors) && r.colors.length > 1) ? "configurable" : "simple") as "simple" | "configurable",
        colors: Array.isArray(r.colors) ? r.colors.map((c: any) => String(c).trim()).filter(Boolean) : [],
      })).filter((r: any) => r.name);
      usedAi = rows.length > 0;
    } catch { /* fall through */ }
  }
  if (!usedAi) {
    rows = text.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^name\s*,/i.test(l)).map((l) => {
      const [name, price, qty, type, colors] = l.split(",").map((s) => s?.trim() ?? "");
      return { name, basePriceRupees: Number(price) || 0, qty: Number(qty) || 0, type: (type === "configurable" ? "configurable" : "simple") as "simple" | "configurable", colors: (colors ?? "").split("|").map((s) => s.trim()).filter(Boolean) };
    }).filter((r) => r.name);
  }
  return { rows, usedAi };
}

/** Insert ONE product row. The client calls this per row so it can render live progress. */
export async function createOneRowAction(categoryId: string, row: ParsedRow): Promise<RowResult & { name?: string }> {
  if (!(await requirePerm("catalog.create"))) return { row: 0, ok: false, error: "Your role can't add products." };
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const skuNum = await nextSku(sb);
  const res = await insertOne(sb, formula, { ...row, categoryId }, skuNum);
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { ...res, name: row.name };
}

/** Hide (draft) or show (publish) a product on the storefront. */
export async function setProductVisibilityAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.publish"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const status = String(formData.get("status") ?? "") === "published" ? "published" : "draft";
  if (!sku) return;
  await supabaseServer().from("products").update({ status }).eq("sku", sku);
  revalidatePath("/admin/inventory"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
}

/** #1: mark a product as wholesale-only (hidden from the D2C storefront, shown to retailers). */
export async function setWholesaleOnlyAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const on = String(formData.get("wholesale_only") ?? "") === "1";
  if (!sku) return;
  await supabaseServer().from("products").update({ wholesale_only: on }).eq("sku", sku);
  revalidatePath(`/admin/catalogue/${sku}`); revalidatePath("/shop"); revalidatePath("/wholesale");
}

const LABEL_COLORS = ["emerald", "gold", "wine", "rose", "blue", "ink"];

/** #9/#31: create an owner-defined label. */
export async function createLabelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "emerald").trim();
  if (!name) return;
  await supabaseServer().from("labels").upsert({ name, color: LABEL_COLORS.includes(color) ? color : "emerald" }, { onConflict: "name", ignoreDuplicates: true });
  revalidatePath("/admin/categories");
}

export async function deleteLabelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabaseServer().from("labels").delete().eq("id", id);
  revalidatePath("/admin/categories");
}

/** #9/#31: attach/detach a label on a product (from the SKU's Catalog tab). */
export async function toggleProductLabelAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const labelId = String(formData.get("label_id") ?? "");
  const on = String(formData.get("on") ?? "") === "1";
  if (!sku || !labelId) return;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id").ilike("sku", sku).maybeSingle();
  if (!p) return;
  if (on) await sb.from("product_labels").upsert({ product_id: (p as any).id, label_id: labelId }, { onConflict: "product_id,label_id", ignoreDuplicates: true });
  else await sb.from("product_labels").delete().eq("product_id", (p as any).id).eq("label_id", labelId);
  revalidatePath(`/admin/catalogue/${sku}`); revalidatePath("/admin/catalogue"); revalidatePath("/admin/inventory");
}

/** Delete a product (or hide it if it has past orders, to keep the books intact). */
export async function deleteProductAction(formData: FormData): Promise<{ ok: boolean; message: string }> {
  if (!(await requirePerm("catalog.delete"))) return { ok: false, message: "Your role can't delete products." };
  const sku = String(formData.get("sku") ?? "").trim();
  if (!sku) return { ok: false, message: "Missing SKU" };
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,name").eq("sku", sku).maybeSingle();
  if (!p) return { ok: false, message: "Product not found" };
  const pid = (p as any).id;
  await sb.from("product_images").delete().eq("product_id", pid);
  await sb.from("variants").delete().eq("product_id", pid);
  const { error } = await sb.from("products").delete().eq("id", pid);
  revalidatePath("/admin/inventory"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  if (error) {
    await sb.from("products").update({ status: "draft" }).eq("id", pid);
    return { ok: true, message: `${sku} has past orders — hidden from the store instead of deleted.` };
  }
  return { ok: true, message: `Deleted ${(p as any).name} (${sku}).` };
}

export async function createCategoryJsonAction(name: string): Promise<{ id: string; name: string } | null> {
  const nm = name.trim(); if (!nm) return null;
  const sb = supabaseServer();
  const { data } = await sb.from("categories").insert({ name: nm, slug: slugify(nm) }).select("id,name").single();
  revalidatePath("/admin/categories"); revalidatePath("/shop"); revalidatePath("/admin/upload");
  return data ? { id: (data as any).id, name: (data as any).name } : null;
}

// ---------------------------------------------------------------------------
// Subcategories (category hierarchy) — backs the management UI + DIVA.
// Requires migration 0002 (subcategories, product_subcategory_map).
// ---------------------------------------------------------------------------

/** Create a subcategory under a parent category (by id or name). */
export async function createSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const sb = supabaseServer();
  let categoryId = String(formData.get("category_id") ?? "").trim() || null;
  const parentName = String(formData.get("parent") ?? "").trim();
  if (!categoryId && parentName) {
    const { data: pc } = await sb.from("categories").select("id").ilike("name", parentName).maybeSingle();
    categoryId = (pc as any)?.id ?? null;
  }
  await sb.from("subcategories").insert({ name, slug: slugify(name), category_id: categoryId });
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Rename a subcategory. */
export async function renameSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!id || !name) return;
  await supabaseServer().from("subcategories").update({ name, slug: slugify(name) }).eq("id", id);
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Delete a subcategory (products fall back to their parent category; map rows cascade). */
export async function deleteSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await supabaseServer().from("subcategories").delete().eq("id", id);
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Reorder subcategories: pass an ordered list of ids; sets their `sort` to match. */
export async function reorderSubcategoriesAction(ids: string[]): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sb = supabaseServer();
  await Promise.all(ids.map((id, i) => sb.from("subcategories").update({ sort: i }).eq("id", id)));
  revalidatePath("/admin/categories"); revalidatePath("/shop");
}

/** Move a product into a subcategory (sets the primary; trigger keeps the M2M map in sync). */
export async function moveProductToSubcategoryAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  const subcategoryId = String(formData.get("subcategory_id") ?? "").trim() || null;
  if (!sku) return;
  const sb = supabaseServer();
  await sb.from("products").update({ subcategory_id: subcategoryId }).eq("sku", sku);
  revalidatePath("/admin/categories"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
}

// ---------------------------------------------------------------------------
// Pricing overrides (Phase 4) — explicit per-product / per-variant tier prices.
// Requires migration 0003. Blank/0 input clears the override (back to formula).
// ---------------------------------------------------------------------------

/** Rupees text → integer paise, or null when blank / non-positive (= inherit formula). */
function rupeesToPaiseOrNull(raw: FormDataEntryValue | null): number | null {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export async function savePricingAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit"))) return;
  const sku = String(formData.get("sku") ?? "").trim();
  if (!sku) return;
  const sb = supabaseServer();
  const { data: prod } = await sb.from("products").select("id").eq("sku", sku).maybeSingle();
  if (!prod) return;

  // Product-level overrides.
  await sb.from("products").update({
    wholesale_override: rupeesToPaiseOrNull(formData.get("p_wholesale")),
    retail_override: rupeesToPaiseOrNull(formData.get("p_retail")),
    mrp_override: rupeesToPaiseOrNull(formData.get("p_mrp")),
  }).eq("id", (prod as any).id);

  // Variant-level overrides — fields named v_<variantId>_(w|r|m).
  const byVariant = new Map<string, { w: number | null; r: number | null; m: number | null }>();
  for (const [key, val] of formData.entries()) {
    const mm = /^v_(.+)_(w|r|m)$/.exec(key);
    if (!mm) continue;
    const [, id, tier] = mm;
    const cur = byVariant.get(id) ?? { w: null, r: null, m: null };
    (cur as any)[tier] = rupeesToPaiseOrNull(val);
    byVariant.set(id, cur);
  }
  await Promise.all(
    [...byVariant.entries()].map(([id, o]) =>
      sb.from("variants").update({ wholesale_override: o.w, retail_override: o.r, mrp_override: o.m }).eq("id", id),
    ),
  );

  revalidatePath(`/admin/catalogue/${sku}`);
  revalidatePath(`/admin/product/${sku}`);
  revalidatePath("/shop");
  revalidatePath("/wholesale");
}

import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "@/lib/ai/providers";

/** AI-processed bulk import: reads a messy CSV/spreadsheet/freeform list, maps columns
 *  intelligently to {name, base_price, qty, type, colors}, then inserts. Falls back to
 *  naive comma parsing if no AI key. */
export async function aiBulkUploadAction(categoryId: string, rawText: string): Promise<{ created: number; results: RowResult[]; usedAi: boolean }> {
  if (!(await requirePerm("catalog.create"))) return { created: 0, results: [{ row: 0, ok: false, error: "Your role can't add products." }], usedAi: false };
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  let rows: Omit<NewProduct, "categoryId">[] = [];
  let usedAi = false;

  const text = (rawText ?? "").trim().slice(0, 8000);
  if (text && (groqConfigured() || openaiConfigured())) {
    const system = `You convert a messy product list into clean JSON for a jewellery store. Output STRICT JSON: {"rows":[{"name":string,"base_price":number,"qty":number,"type":"simple"|"configurable","colors":string[]}]}. The input may be CSV, tab-separated, or freeform, with columns in any order or with different header names (price/cost/wholesale -> base_price in rupees as a number; quantity/stock/pcs -> qty integer; colours/variants -> colors array; if multiple colours are present set type to "configurable" else "simple"). Ignore header rows and currency symbols. Infer sensibly. Return ONLY JSON.`;
    try {
      const out = groqConfigured() ? await groqChat({ system, user: text, json: true }) : await openaiChat({ system, user: text, json: true });
      const parsed = JSON.parse(out);
      rows = (parsed.rows ?? []).map((r: any) => ({
        name: String(r.name ?? "").trim(),
        basePriceRupees: Number(r.base_price) || 0,
        qty: parseInt(r.qty, 10) || 0,
        type: r.type === "configurable" || (Array.isArray(r.colors) && r.colors.length > 1) ? "configurable" : "simple",
        colors: Array.isArray(r.colors) ? r.colors.map((c: any) => String(c).trim()).filter(Boolean) : [],
      })).filter((r: any) => r.name);
      usedAi = rows.length > 0;
    } catch { /* fall through to naive */ }
  }

  if (!usedAi) {
    rows = text.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^name\s*,/i.test(l)).map((l) => {
      const [name, price, qty, type, colors] = l.split(",").map((s) => s?.trim() ?? "");
      return { name, basePriceRupees: Number(price) || 0, qty: Number(qty) || 0, type: (type === "configurable" ? "configurable" : "simple") as "simple" | "configurable", colors: (colors ?? "").split("|").map((s) => s.trim()).filter(Boolean) };
    });
  }

  let skuNum = await nextSku(sb);
  const results: RowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const res = await insertOne(sb, formula, { ...rows[i], categoryId }, skuNum);
    results.push({ ...res, row: i + 1 });
    if (res.ok) skuNum++;
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { created: results.filter((r) => r.ok).length, results, usedAi };
}
