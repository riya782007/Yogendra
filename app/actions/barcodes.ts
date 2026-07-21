"use server";
/**
 * Live barcode-label lookup. The Barcode Labels page loads its product list once when the page renders;
 * a product or colour created AFTER that (or edited in another tab) isn't in that list, so searching
 * for it found nothing. This queries the database directly so a freshly created SKU is always findable
 * without a reload — the same fix the POS uses. Returns the product row plus its colour variants.
 */
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";

export type LabelHit = {
  sku: string; name: string; price: number; wholesale: number; mrp: number;
  kind: "product" | "variant"; option?: string; parentSku?: string; variantCount?: number;
};

export async function barcodeLookupAction(rawCode: string): Promise<LabelHit[]> {
  if (!(await requirePerm("inventory.barcode"))) return [];
  const code = (rawCode ?? "").trim();
  if (code.length < 2) return [];
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const like = code.replace(/[%,()]/g, "");
  const PSEL = "sku,name,base_wholesale,wholesale_override,retail_override,mrp_override, variants(sku,color,size,polish,wholesale_override,retail_override,mrp_override)";

  // Match a product by SKU or name, OR a product that owns a matching variant SKU.
  const [byProduct, byVariant] = await Promise.all([
    sb.from("products").select(PSEL).or(`sku.ilike.%${like}%,name.ilike.%${like}%`).limit(15),
    sb.from("variants").select("product_id").ilike("sku", `%${like}%`).limit(30),
  ]);

  const productIds = Array.from(new Set(((byVariant.data as any[]) ?? []).map((v) => v.product_id).filter(Boolean)));
  let extra: any[] = [];
  if (productIds.length) {
    const { data } = await sb.from("products").select(PSEL).in("id", productIds).limit(30);
    extra = (data as any[]) ?? [];
  }

  const seen = new Set<string>();
  const products = [...((byProduct.data as any[]) ?? []), ...extra].filter((p) => {
    const k = String(p.sku).toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true;
  });

  const out: LabelHit[] = [];
  for (const p of products) {
    const vs = ((p.variants as any[]) ?? []).filter((v) => v.sku);
    const pp = resolvePrices(p.base_wholesale, formula, overridesOf(null), overridesOf(p));
    out.push({ sku: p.sku, name: p.name, price: pp.retailPrice, wholesale: pp.wholesaleRate, mrp: pp.mrp, kind: "product", variantCount: vs.length });
    for (const v of vs) {
      const opt = [v.color, v.size, v.polish].filter(Boolean).join(" / ");
      const vp = resolvePrices(p.base_wholesale, formula, overridesOf(v), overridesOf(p));
      out.push({ sku: v.sku, name: `${p.name}${opt ? ` — ${opt}` : ""}`, price: vp.retailPrice, wholesale: vp.wholesaleRate, mrp: vp.mrp, kind: "variant", option: opt || undefined, parentSku: p.sku });
    }
  }
  return out;
}
