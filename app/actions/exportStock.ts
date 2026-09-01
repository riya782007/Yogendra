"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

type ExportFilter = { categoryId?: string; subcategoryId?: string };

/**
 * Full or taxonomy-filtered stock export — every sellable SKU with LIVE stock as Excel-ready CSV.
 * One row per variant; simple products get one product-level row. Paged beyond Supabase's 1000-row cap.
 */
export async function exportStockCsvAction(filter: ExportFilter = {}): Promise<{ ok: boolean; csv?: string; count?: number; error?: string }> {
  if (!(await requirePerm("inventory.view"))) return { ok: false, error: "Your role can't export stock." };
  const sb = supabaseServer();

  const [categories, subcategories] = await Promise.all([
    sb.from("categories").select("id,name"),
    sb.from("subcategories").select("id,name"),
  ]);
  const catName = new Map(((categories.data as any[]) ?? []).map((c) => [c.id, c.name ?? ""]));
  const subcategoryName = new Map(((subcategories.data as any[]) ?? []).map((s) => [s.id, s.name ?? ""]));

  // The UI submits IDs from the category tree. Validate their relationship before exporting so a
  // mismatched or stale selection cannot produce an unexpected cross-category export.
  if (filter.subcategoryId) {
    const { data: subcategory } = await sb.from("subcategories").select("category_id").eq("id", filter.subcategoryId).maybeSingle();
    if (!subcategory || (filter.categoryId && (subcategory as any).category_id !== filter.categoryId)) {
      return { ok: false, error: "That subcategory is no longer available. Refresh and try again." };
    }
  }

  const products = new Map<string, { sku: string; name: string; category: string; subcategory: string; qty: number; hasVariant: boolean }>();
  for (let from = 0; ; from += 1000) {
    let query = sb.from("products").select("id,sku,name,category_id,subcategory_id,qty").order("sku");
    if (filter.categoryId) query = query.eq("category_id", filter.categoryId);
    if (filter.subcategoryId) query = query.eq("subcategory_id", filter.subcategoryId);
    const { data } = await query.range(from, from + 999);
    const page = (data as any[]) ?? [];
    for (const product of page) products.set(product.id, {
      sku: product.sku ?? "", name: product.name ?? "", category: catName.get(product.category_id) ?? "",
      subcategory: subcategoryName.get(product.subcategory_id) ?? "", qty: product.qty ?? 0, hasVariant: false,
    });
    if (page.length < 1000) break;
  }

  const rows: { sku: string; product: string; colour: string; category: string; subcategory: string; qty: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("variants").select("product_id,sku,color,qty").order("sku").range(from, from + 999);
    const page = (data as any[]) ?? [];
    for (const variant of page) {
      const product = products.get(variant.product_id);
      if (!product) continue;
      product.hasVariant = true;
      rows.push({ sku: variant.sku ?? "", product: product.name, colour: variant.color ?? "", category: product.category, subcategory: product.subcategory, qty: variant.qty ?? 0 });
    }
    if (page.length < 1000) break;
  }
  for (const product of products.values()) if (!product.hasVariant) {
    rows.push({ sku: product.sku, product: product.name, colour: "", category: product.category, subcategory: product.subcategory, qty: product.qty });
  }

  rows.sort((a, b) => a.sku.localeCompare(b.sku));
  const escapeCsv = (value: string | number) => { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const header = "SKU,Product,Colour,Category,Subcategory,In Stock";
  const csv = "\uFEFF" + header + "\n" + rows.map((row) => [row.sku, row.product, row.colour, row.category, row.subcategory, row.qty].map(escapeCsv).join(",")).join("\n");
  return { ok: true, csv, count: rows.length };
}
