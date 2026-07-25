"use server";
import { supabaseServer } from "@/lib/supabase/server";

export type SkuHit = { sku: string; name: string };

/**
 * Type-to-search SKU lookup for the admin SKU boxes (returns, estimate/bill add-item, stock adjust …).
 * Returns up to 12 matching pieces — matched on the SKU itself OR the product name, across both
 * variant SKUs (exact colour, e.g. SHKN621-WHITE) and parent product SKUs. Server-side so the box
 * stays instant and we never ship the whole 4,500-product catalogue to the browser.
 */
export async function searchSkusAction(q: string): Promise<SkuHit[]> {
  const term = (q ?? "").trim();
  if (term.length < 2) return [];
  const like = term.replace(/[%,()]/g, "");
  const sb = supabaseServer();
  const seen = new Set<string>();
  const out: SkuHit[] = [];
  const push = (sku: string | null | undefined, name: string) => {
    const s = (sku ?? "").trim();
    if (!s) return;
    const k = s.toUpperCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ sku: s, name: (name ?? "").trim() });
  };

  // Variant SKUs first (they carry the exact colour the owner usually wants).
  const { data: vs } = await sb.from("variants")
    .select("sku, color, product:products(name,sku)")
    .ilike("sku", `%${like}%`).limit(12);
  for (const v of (vs as any[]) ?? []) {
    const nm = [v.product?.name, v.color].filter(Boolean).join(" · ");
    push(v.sku, nm);
  }
  // Parent products — match SKU or NAME so "necklace" or "KN57" both work.
  const { data: ps } = await sb.from("products")
    .select("sku, name")
    .or(`sku.ilike.%${like}%,name.ilike.%${like}%`).limit(12);
  for (const p of (ps as any[]) ?? []) push(p.sku, p.name ?? p.sku);

  return out.slice(0, 12);
}
