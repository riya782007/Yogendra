"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";
import { recomputeEstimateTotal } from "./billing_mod_0";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

type PosItem = { sku: string; name: string; price: number; wholesale: number; mrp: number; category: string; qty: number; parentSku?: string; parentName?: string };

export async function posStockAction(skus: string[]): Promise<{ sku: string; qty: number }[]> {
  if (!(await requirePerm("billing.sell"))) return [];
  const list = (skus ?? []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 200);
  if (!list.length) return [];
  const sb = supabaseServer();
  const out = new Map<string, number>();
  const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
  for (const grp of chunk(list, 60)) {
    const or = grp.map((s) => `sku.ilike.${s.replace(/[,()]/g, "")}`).join(",");
    const [{ data: vs }, { data: ps }] = await Promise.all([
      sb.from("variants").select("sku,qty").or(or),
      sb.from("products").select("sku,qty").or(or),
    ]);
    for (const p of ((ps as any[]) ?? [])) out.set(String(p.sku).toUpperCase(), p.qty ?? 0);
    for (const v of ((vs as any[]) ?? [])) out.set(String(v.sku).toUpperCase(), v.qty ?? 0);
  }
  return list.filter((s) => out.has(s.toUpperCase())).map((s) => ({ sku: s, qty: out.get(s.toUpperCase()) ?? 0 }));
}

export async function posLookupAction(rawCode: string): Promise<PosItem[]> {
  if (!(await requirePerm("billing.sell")) && !(await requirePerm("estimates.create"))) return [];
  const code = (rawCode ?? "").trim();
  if (!code) return [];
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const priceOf = (base: number, vOv: any, pOv: any) => {
    const r = resolvePrices(base ?? 0, formula, vOv ?? {}, pOv ?? {});
    return { price: r.retailPrice, wholesale: r.wholesaleRate, mrp: r.mrp };
  };
  const out: PosItem[] = [];
  const seen = new Set<string>();
  const push = (it: PosItem) => { const k = it.sku.toUpperCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } };
  const emitProduct = (p: any) => {
    const cat = p.category?.name ?? "";
    const vs = (p.variants as any[]) ?? [];
    if (vs.length) {
      for (const v of vs) {
        const pr = priceOf(p.base_wholesale, overridesOf(v), overridesOf(p));
        push({ sku: v.sku, name: `${p.name}${v.color ? " · " + v.color : ""}`, ...pr, category: cat, qty: v.qty ?? 0, parentSku: p.sku, parentName: p.name });
      }
    } else {
      const pr = priceOf(p.base_wholesale, {}, overridesOf(p));
      push({ sku: p.sku, name: p.name, ...pr, category: cat, qty: p.qty ?? 0 });
    }
  };
  const PSEL = "id,sku,name,qty,base_wholesale,retail_override,wholesale_override,mrp_override, category:categories(name), variants(sku,color,qty,retail_override,wholesale_override,mrp_override)";
  const { data: vexact } = await sb.from("variants").select("sku,color,qty,retail_override,wholesale_override,mrp_override, product:products(" + PSEL + ")").ilike("sku", code).limit(1).maybeSingle();
  if (vexact && (vexact as any).product) {
    const p = (vexact as any).product; const v = vexact as any;
    const pr = priceOf(p.base_wholesale, overridesOf(v), overridesOf(p));
    push({ sku: v.sku, name: `${p.name}${v.color ? " · " + v.color : ""}`, ...pr, category: p.category?.name ?? "", qty: v.qty ?? 0, parentSku: p.sku, parentName: p.name });
    return out;
  }
  const { data: pexact } = await sb.from("products").select(PSEL).ilike("sku", code).limit(1).maybeSingle();
  if (pexact) { emitProduct(pexact); if (out.length) return out; }
  const like = `%${code}%`;
  const [{ data: pmatch }, { data: vmatch }] = await Promise.all([
    sb.from("products").select(PSEL).or(`sku.ilike.${like},name.ilike.${like}`).limit(8),
    sb.from("variants").select("sku,color,qty,retail_override,wholesale_override,mrp_override, product:products(" + PSEL + ")").ilike("sku", like).limit(8),
  ]);
  for (const p of ((pmatch as any[]) ?? [])) emitProduct(p);
  for (const v of ((vmatch as any[]) ?? [])) {
    const p = (v as any).product; if (!p) continue;
    const pr = priceOf(p.base_wholesale, overridesOf(v), overridesOf(p));
    push({ sku: (v as any).sku, name: `${p.name}${(v as any).color ? " · " + (v as any).color : ""}`, ...pr, category: p.category?.name ?? "", qty: (v as any).qty ?? 0, parentSku: p.sku, parentName: p.name });
  }
  return out.slice(0, 12);
}

export async function addEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const estimateId = String(formData.get("estimate_id") ?? "");
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const qty = Math.max(1, Math.floor(Number(formData.get("qty") ?? 1)));
  if (!estimateId || !sku) return;
  const sb = supabaseServer();
  const { data: v } = await sb.from("variants").select("id,product_id,wholesale_override,retail_override,product:products(base_wholesale,wholesale_override,retail_override,mrp_override)").ilike("sku", sku).maybeSingle();
  let productId: string, variantId: string | null = null, base: number, ov: any;
  if (v) {
    const vp = (v as any).product;
    productId = (v as any).product_id; variantId = (v as any).id; base = vp.base_wholesale;
    ov = { wholesale_override: (v as any).wholesale_override ?? vp.wholesale_override, retail_override: (v as any).retail_override ?? vp.retail_override, mrp_override: vp.mrp_override };
  } else {
    const { data: p } = await sb.from("products").select("id,base_wholesale,wholesale_override,retail_override,mrp_override").ilike("sku", sku).maybeSingle();
    if (!p) return;
    productId = (p as any).id; base = (p as any).base_wholesale; ov = overridesOf(p);
  }
  const formula = await getPricingFormula();
  const unit = resolvePrices(base, formula, ov).retailPrice;
  await sb.from("estimate_items").insert({ estimate_id: estimateId, product_id: productId, variant_id: variantId, qty, unit_price: unit, line_total: unit * qty });
  await recomputeEstimateTotal(sb, estimateId);
  await sb.rpc("resync_estimate_hold", { p_estimate_id: estimateId });
  revalidatePath(`/admin/estimate/${estimateId}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}
