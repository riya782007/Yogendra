"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { inferStockKind } from "@/lib/stockKind";

/**
 * Adjust stock by a signed delta, tagged with a SOURCE + typed KIND so every movement
 * is traceable. Works at PRODUCT level, or at VARIANT level when `variant_id` is given
 * (in which case the product's qty is rolled up from the sum of its variants).
 * Logged to stock_adjustments.
 */
export async function adjustStockAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "").trim();
  const variantId = String(formData.get("variant_id") ?? "").trim() || null;
  const delta = Math.trunc(Number(formData.get("delta") ?? 0));
  const source = String(formData.get("source") ?? "").trim() || "Manual adjustment";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "").trim() || inferStockKind(source);
  if (!sku || !delta) return;
  // Strict: adding needs inventory.add, removing needs inventory.remove.
  if (!(await requirePerm(delta > 0 ? "inventory.add" : "inventory.remove"))) return;

  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,qty").eq("sku", sku).maybeSingle();
  if (!p) return;
  const pid = (p as any).id;
  const now = new Date().toISOString();

  if (variantId) {
    // Variant-level: adjust the variant, then roll the product qty up to the variant sum.
    const { data: v } = await sb.from("variants").select("id,qty,sku").eq("id", variantId).eq("product_id", pid).maybeSingle();
    if (!v) return;
    const vNew = Math.max(0, ((v as any).qty ?? 0) + delta);
    await sb.from("variants").update({ qty: vNew }).eq("id", variantId);
    const { data: siblings } = await sb.from("variants").select("qty").eq("product_id", pid);
    const total = ((siblings as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    await sb.from("products").update({ qty: total, last_movement_at: now }).eq("id", pid);
    await sb.from("stock_adjustments").insert({ product_id: pid, variant_id: variantId, sku: (v as any).sku ?? sku, delta, source, reason, kind });
  } else {
    const newQty = Math.max(0, ((p as any).qty ?? 0) + delta);
    await sb.from("products").update({ qty: newQty, last_movement_at: now }).eq("id", pid);
    await sb.from("stock_adjustments").insert({ product_id: pid, sku, delta, source, reason, kind });
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/catalogue/${sku}`);
  revalidatePath(`/admin/product/${sku}`);
}
