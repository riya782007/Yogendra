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
  // SKUs are stored upper-case; the owner often types "Bd1001". Normalise so a
  // case/spacing slip never silently no-ops ("Apply does nothing").
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const variantId = String(formData.get("variant_id") ?? "").trim() || null;
  const delta = Math.trunc(Number(formData.get("delta") ?? 0));
  const source = String(formData.get("source") ?? "").trim() || "Manual adjustment";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "").trim() || inferStockKind(source);
  if (!sku || !delta) return;
  // Strict: adding needs inventory.add, removing needs inventory.remove.
  if (!(await requirePerm(delta > 0 ? "inventory.add" : "inventory.remove"))) return;

  const sb = supabaseServer();
  const now = new Date().toISOString();
  // Case-insensitive so a typed "Bd1001" still resolves to the stored "BD1001".
  const { data: p } = await sb.from("products").select("id,qty").ilike("sku", sku).maybeSingle();

  if (!p) {
    // Not a product SKU — it may be a VARIANT's own SKU (e.g. a scanned variant barcode
    // or a colour/size SKU typed directly). Adjust the variant and roll the product up.
    const { data: v } = await sb.from("variants").select("id,qty,product_id,sku").ilike("sku", sku).maybeSingle();
    if (!v) return;
    const vid = (v as any).id, pid = (v as any).product_id;
    const oldQ = (v as any).qty ?? 0;
    const vNew = Math.max(0, oldQ + delta);
    const applied = vNew - oldQ;
    if (applied === 0) return; // already at 0 — never log a phantom movement
    await sb.from("variants").update({ qty: vNew }).eq("id", vid);
    const { data: siblings } = await sb.from("variants").select("qty").eq("product_id", pid);
    const total = ((siblings as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    await sb.from("products").update({ qty: total, last_movement_at: now }).eq("id", pid);
    await sb.from("stock_adjustments").insert({ product_id: pid, variant_id: vid, sku: (v as any).sku ?? sku, delta: applied, source, reason, kind });
  } else {
    const pid = (p as any).id;
    if (variantId) {
      // Variant-level: adjust the variant, then roll the product qty up to the variant sum.
      const { data: v } = await sb.from("variants").select("id,qty,sku").eq("id", variantId).eq("product_id", pid).maybeSingle();
      if (!v) return;
      const oldQ = (v as any).qty ?? 0;
      const vNew = Math.max(0, oldQ + delta);
      const applied = vNew - oldQ;
      if (applied === 0) return; // nothing to remove (already 0) — no phantom -10 movements
      await sb.from("variants").update({ qty: vNew }).eq("id", variantId);
      const { data: siblings } = await sb.from("variants").select("qty").eq("product_id", pid);
      const total = ((siblings as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
      await sb.from("products").update({ qty: total, last_movement_at: now }).eq("id", pid);
      await sb.from("stock_adjustments").insert({ product_id: pid, variant_id: variantId, sku: (v as any).sku ?? sku, delta: applied, source, reason, kind });
    } else {
      const oldQ = (p as any).qty ?? 0;
      const newQty = Math.max(0, oldQ + delta);
      const applied = newQty - oldQ;
      if (applied === 0) return; // already at the floor — don't log a phantom movement
      await sb.from("products").update({ qty: newQty, last_movement_at: now }).eq("id", pid);
      await sb.from("stock_adjustments").insert({ product_id: pid, sku, delta: applied, source, reason, kind });
    }
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/catalogue/${sku}`);
  revalidatePath(`/admin/product/${sku}`);
}
