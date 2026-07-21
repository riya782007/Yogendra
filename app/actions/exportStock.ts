"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/**
 * Full stock export — every sellable SKU with its LIVE stock, as CSV (opens directly in Excel).
 * One row per variant (its own SKU + colour + qty); simple products (no colours) get their own row.
 * Paged past Supabase's 1000-row cap so the whole catalogue comes through. Read-only.
 */
export async function exportStockCsvAction(): Promise<{ ok: boolean; csv?: string; count?: number; error?: string }> {
  if (!(await requirePerm("inventory.view"))) return { ok: false, error: "Your role can't export stock." };
  const sb = supabaseServer();

  const catName = new Map<string, string>();
  {
    const { data } = await sb.from("categories").select("id,name");
    for (const c of ((data as any[]) ?? [])) catName.set(c.id, c.name ?? "");
  }

  // All products (id → sku/name/category/qty), paged.
  const prod = new Map<string, { sku: string; name: string; cat: string; qty: number; hasVar: boolean }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("products").select("id,sku,name,category_id,qty").order("sku").range(from, from + 999);
    const arr = (data as any[]) ?? [];
    for (const p of arr) prod.set(p.id, { sku: p.sku ?? "", name: p.name ?? "", cat: catName.get(p.category_id) ?? "", qty: p.qty ?? 0, hasVar: false });
    if (arr.length < 1000) break;
  }

  // All variants → one row each; mark their parent as "has variants".
  const rows: { sku: string; product: string; colour: string; cat: string; qty: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("variants").select("product_id,sku,color,qty").order("sku").range(from, from + 999);
    const arr = (data as any[]) ?? [];
    for (const v of arr) {
      const p = prod.get(v.product_id);
      if (p) p.hasVar = true;
      rows.push({ sku: v.sku ?? "", product: p?.name ?? "", colour: v.color ?? "", cat: p?.cat ?? "", qty: v.qty ?? 0 });
    }
    if (arr.length < 1000) break;
  }
  // Simple products (no colours) contribute their own product-level row.
  for (const p of prod.values()) if (!p.hasVar) rows.push({ sku: p.sku, product: p.name, colour: "", cat: p.cat, qty: p.qty });

  rows.sort((a, b) => a.sku.localeCompare(b.sku));

  const esc = (v: string | number) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const header = "SKU,Product,Colour,Category,In Stock";
  const csv = "﻿" + header + "\n" + rows.map((r) => [r.sku, r.product, r.colour, r.cat, r.qty].map(esc).join(",")).join("\n");
  return { ok: true, csv, count: rows.length };
}
