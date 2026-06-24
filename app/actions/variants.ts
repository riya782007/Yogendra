"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const BUCKET = "product-media";

/** Build a readable variant SKU suffix from whichever attribute is present. */
function autoSku(productSku: string, label: string): string {
  return `${productSku}-${label.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase() || "VAR"}`;
}

/** Remember any new colour/size/polish value so the master list grows itself. */
async function rememberOptions(sb: ReturnType<typeof supabaseServer>, o: { color?: string; size?: string; polish?: string }) {
  const rows: { kind: string; value: string }[] = [];
  if (o.color) rows.push({ kind: "color", value: o.color });
  if (o.size) rows.push({ kind: "size", value: o.size });
  if (o.polish) rows.push({ kind: "polish", value: o.polish });
  if (rows.length) await sb.from("variant_options").upsert(rows, { onConflict: "kind,value", ignoreDuplicates: true });
}

function reval(productSku: string) {
  revalidatePath(`/admin/catalogue/${productSku}`);
  revalidatePath(`/admin/product/${productSku}`);
  revalidatePath("/shop");
}

export async function addVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const productSku = String(formData.get("product_sku") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const polish = String(formData.get("polish") ?? "").trim();
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  let vsku = String(formData.get("sku") ?? "").trim().toUpperCase();
  // At least one attribute is required so the variant is meaningful.
  if (!productSku || !(color || size || polish)) return;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,type").ilike("sku", productSku).maybeSingle();
  if (!p) return;
  if (!vsku) vsku = autoSku(productSku, [color, size, polish].filter(Boolean).join("-"));
  await sb.from("variants").insert({ product_id: (p as any).id, color: color || null, size: size || null, polish: polish || null, sku: vsku, qty });
  await rememberOptions(sb, { color, size, polish });
  if ((p as any).type !== "configurable") await sb.from("products").update({ type: "configurable" }).eq("id", (p as any).id);
  reval(productSku);
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const polish = String(formData.get("polish") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  if (!id || !(color || size || polish)) return;
  const sb = supabaseServer();
  await sb.from("variants").update({
    color: color || null, size: size || null, polish: polish || null,
    sku: sku || autoSku(productSku, [color, size, polish].filter(Boolean).join("-")), qty,
  }).eq("id", id);
  await rememberOptions(sb, { color, size, polish });
  reval(productSku);
}

export async function deleteVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  await supabaseServer().from("variants").delete().eq("id", id);
  reval(productSku);
}

/** Upload one or more photos for a single variant (so blue shows the blue piece, etc.). */
export async function addVariantImageAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  if (!id) return;
  const sb = supabaseServer();
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return;
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const { data: v } = await sb.from("variants").select("image_paths").eq("id", id).maybeSingle();
  const paths: string[] = [...(((v as any)?.image_paths as string[]) ?? [])];
  for (const file of files) {
    const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
    const path = `variants/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
    if (!up.error) paths.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
  }
  await sb.from("variants").update({ image_paths: paths }).eq("id", id);
  reval(productSku);
}

export async function deleteVariantImageAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!id || !url) return;
  const sb = supabaseServer();
  const { data: v } = await sb.from("variants").select("image_paths").eq("id", id).maybeSingle();
  const paths = (((v as any)?.image_paths as string[]) ?? []).filter((u) => u !== url);
  await sb.from("variants").update({ image_paths: paths }).eq("id", id);
  reval(productSku);
}
