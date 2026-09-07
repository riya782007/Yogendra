"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getSession, requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { supabaseServer } from "@/lib/supabase/server";

export type StockCountTarget = { productId: string; variantId: string | null; sku: string; name: string; label: string; qty: number };

export async function findStockCountTargetAction(rawSku: string): Promise<StockCountTarget | null> {
  if (!(await requirePerm("inventory.view"))) return null;
  const sku = rawSku.trim().toUpperCase();
  if (!sku) return null;
  const sb = supabaseServer();
  const { data: variant } = await sb.from("variants").select("id,product_id,sku,qty,color,product:products(id,name)").ilike("sku", sku).maybeSingle();
  if (variant) {
    const v: any = variant;
    return { productId: v.product_id, variantId: v.id, sku: v.sku, name: v.product?.name ?? v.sku, label: v.color ?? v.sku, qty: v.qty ?? 0 };
  }
  const { data: product } = await sb.from("products").select("id,sku,name,qty,variants(id)").ilike("sku", sku).maybeSingle();
  if (!product || ((product as any).variants ?? []).length) return null;
  const p: any = product;
  return { productId: p.id, variantId: null, sku: p.sku, name: p.name, label: "Whole product", qty: p.qty ?? 0 };
}

export async function recordStockCountAction(input: { productId: string; variantId: string | null; expectedQty: number; physicalQty: number; reason: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  const physicalQty = Math.trunc(Number(input.physicalQty));
  const expectedQty = Math.trunc(Number(input.expectedQty));
  if (!input.productId || !Number.isInteger(physicalQty) || physicalQty < 0 || !Number.isInteger(expectedQty) || expectedQty < 0) return { ok: false, error: "Enter a valid physical quantity." };
  const sb = supabaseServer();
  const { data: target } = await sb.from("products").select("id,sku,qty").eq("id", input.productId).maybeSingle();
  if (!target) return { ok: false, error: "Item no longer exists." };
  const current = input.variantId
    ? await sb.from("variants").select("qty").eq("id", input.variantId).eq("product_id", input.productId).maybeSingle()
    : { data: target };
  const currentQty = Number((current.data as any)?.qty ?? -1);
  if (currentQty < 0) return { ok: false, error: "Item no longer exists." };
  if (!(await requirePerm(physicalQty > currentQty ? "inventory.add" : "inventory.remove"))) return { ok: false, error: "Your role cannot make this stock adjustment." };
  const actor = getSession().roleName || "Owner";
  const { data, error } = await (sb.rpc as any)("record_stock_reconciliation", {
    p_product_id: input.productId, p_variant_id: input.variantId, p_expected_qty: expectedQty,
    p_physical_qty: physicalQty, p_reason: input.reason, p_note: input.note?.slice(0, 500) ?? null, p_actor: actor,
  });
  if (error) return { ok: false, error: error.message };
  const r: any = data;
  await logActivity({ action: "stock_reconciled", ref: (target as any).sku, detail: `Physical ${r.physical_qty} vs system ${r.system_qty}; ${r.delta > 0 ? "+" : ""}${r.delta} pcs; ${r.reason}; value impact ₹${(r.inventory_value_impact / 100).toLocaleString("en-IN")}` }).catch(() => {});
  revalidatePath("/admin/stock-reconciliation"); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements"); revalidatePath(`/admin/catalogue/${(target as any).sku}`); revalidateTag("storefront");
  return { ok: true };
}
