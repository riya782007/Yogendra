"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/** Auto SKU from the product SKU + variant attributes (colour/size/polish). */
function autoSku(productSku: string, color: string, size: string, polish: string): string {
  const code = [color, size, polish]
    .filter(Boolean)
    .map((s) => s.replace(/[^a-z0-9]/gi, "").slice(0, 3).toUpperCase())
    .join("");
  return `${productSku}-${code || "VAR"}`;
}

export async function addVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const productSku = String(formData.get("product_sku") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const polish = String(formData.get("polish") ?? "").trim();
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  let vsku = String(formData.get("sku") ?? "").trim();
  // A variant needs at least one distinguishing attribute.
  if (!productSku || !(color || size || polish)) return;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,type").eq("sku", productSku).maybeSingle();
  if (!p) return;
  if (!vsku) vsku = autoSku(productSku, color, size, polish);
  await sb.from("variants").insert({ product_id: (p as any).id, color: color || null, size: size || null, polish: polish || null, sku: vsku, qty });
  // A product with variants is configurable.
  if ((p as any).type !== "configurable") await sb.from("products").update({ type: "configurable" }).eq("id", (p as any).id);
  revalidatePath(`/admin/catalogue/${productSku}`); revalidatePath(`/admin/product/${productSku}`); revalidatePath("/shop");
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const polish = String(formData.get("polish") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  if (!id || !(color || size || polish)) return;
  await supabaseServer().from("variants")
    .update({ color: color || null, size: size || null, polish: polish || null, sku: sku || autoSku(productSku, color, size, polish), qty })
    .eq("id", id);
  revalidatePath(`/admin/catalogue/${productSku}`); revalidatePath(`/admin/product/${productSku}`);
}

export async function deleteVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  await supabaseServer().from("variants").delete().eq("id", id);
  revalidatePath(`/admin/catalogue/${productSku}`); revalidatePath(`/admin/product/${productSku}`);
}
