"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computePrices, isValidPriceSet } from "@/lib/pricing";
import { getPricingFormula } from "@/lib/supabase/queries";

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export async function createCategoryAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const sb = supabaseServer();
  await sb.from("categories").insert({ name, slug: slugify(name) });
  revalidatePath("/admin/categories");
  revalidatePath("/shop");
}

async function nextSku(sb: ReturnType<typeof supabaseServer>): Promise<number> {
  const { data } = await sb.from("products").select("sku");
  const max = Math.max(999, ...((data ?? []).map((r: any) => parseInt(String(r.sku).replace(/\D/g, ""), 10) || 0)));
  return max + 1;
}

export type NewProduct = { categoryId: string; name: string; basePriceRupees: number; qty: number; type: "simple" | "configurable"; colors: string[] };
export type RowResult = { row: number; ok: boolean; sku?: string; error?: string };

async function insertOne(sb: ReturnType<typeof supabaseServer>, formula: any, n: NewProduct, skuNum: number): Promise<RowResult> {
  if (!n.name) return { row: skuNum, ok: false, error: "Missing name" };
  if (!(n.basePriceRupees > 0)) return { row: skuNum, ok: false, error: "Base price must be > 0" };
  if (!n.categoryId) return { row: skuNum, ok: false, error: "Missing category" };
  const prices = computePrices(n.basePriceRupees * 100, formula);
  if (!isValidPriceSet(prices)) return { row: skuNum, ok: false, error: "Computed price invalid — flagged" };
  const sku = `BD${skuNum}`;
  const { data: prod, error } = await sb.from("products").insert({
    category_id: n.categoryId, sku, name: n.name, type: n.type,
    base_wholesale: n.basePriceRupees * 100, qty: Math.max(0, n.qty), status: "published", last_movement_at: new Date().toISOString(),
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
  const sb = supabaseServer();
  const [formula, sku] = await Promise.all([getPricingFormula(), nextSku(sb)]);
  const res = await insertOne(sb, formula, p, sku);
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return res;
}

export async function bulkUploadAction(categoryId: string, rows: Omit<NewProduct, "categoryId">[]): Promise<{ created: number; results: RowResult[] }> {
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
  const sb = supabaseServer();
  const n: NewProduct = {
    categoryId: String(formData.get("categoryId") ?? ""),
    name: String(formData.get("name") ?? "").trim(),
    basePriceRupees: Number(formData.get("price")) || 0,
    qty: Number(formData.get("qty")) || 0,
    type: String(formData.get("type")) === "configurable" ? "configurable" : "simple",
    colors: String(formData.get("colors") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
  const [formula, skuNum] = await Promise.all([getPricingFormula(), nextSku(sb)]);
  const res = await insertOne(sb, formula, n, skuNum);
  if (res.ok && res.sku) {
    const file = formData.get("image") as File | null;
    if (file && typeof file === "object" && file.size > 0) {
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
  }
  revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return res;
}

export async function createCategoryJsonAction(name: string): Promise<{ id: string; name: string } | null> {
  const nm = name.trim(); if (!nm) return null;
  const sb = supabaseServer();
  const { data } = await sb.from("categories").insert({ name: nm, slug: slugify(nm) }).select("id,name").single();
  revalidatePath("/admin/categories"); revalidatePath("/shop"); revalidatePath("/admin/upload");
  return data ? { id: (data as any).id, name: (data as any).name } : null;
}

import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "@/lib/ai/providers";

/** AI-processed bulk import: reads a messy CSV/spreadsheet/freeform list, maps columns
 *  intelligently to {name, base_price, qty, type, colors}, then inserts. Falls back to
 *  naive comma parsing if no AI key. */
export async function aiBulkUploadAction(categoryId: string, rawText: string): Promise<{ created: number; results: RowResult[]; usedAi: boolean }> {
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
