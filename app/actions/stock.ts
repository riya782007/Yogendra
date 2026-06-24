"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/**
 * Adjust a product's stock by a signed delta, tagged with a SOURCE so re-added
 * inventory is always traceable (e.g. items a walk-in removed from the cart in-store).
 * Logged to stock_adjustments for the audit trail.
 */
export async function adjustStockAction(formData: FormData): Promise<void> {
  const sku = String(formData.get("sku") ?? "").trim();
  const delta = Math.trunc(Number(formData.get("delta") ?? 0));
  const source = String(formData.get("source") ?? "").trim() || "Manual adjustment";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!sku || !delta) return;
  // Strict: adding needs inventory.add, removing needs inventory.remove.
  if (!(await requirePerm(delta > 0 ? "inventory.add" : "inventory.remove"))) return;

  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,qty").eq("sku", sku).maybeSingle();
  if (!p) return;
  const newQty = Math.max(0, ((p as any).qty ?? 0) + delta);
  await sb.from("products").update({ qty: newQty, last_movement_at: new Date().toISOString() }).eq("id", (p as any).id);
  await sb.from("stock_adjustments").insert({ product_id: (p as any).id, sku, delta, source, reason });

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/catalogue/${sku}`);
  revalidatePath(`/admin/product/${sku}`);
}
