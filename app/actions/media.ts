"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

const BUCKET = "product-media";

export async function uploadProductImageAction(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  const sku = String(formData.get("sku") ?? "");
  const kind = String(formData.get("kind") ?? "flatlay"); // flatlay | angle
  const file = formData.get("image") as File | null;
  if (!file || typeof file !== "object" || file.size === 0) return { ok: false, error: "No image selected" };
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id").eq("sku", sku).maybeSingle();
  if (!p) return { ok: false, error: "Product not found" };
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
  const path = `${sku}/${kind}-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
  if (up.error) return { ok: false, error: up.error.message };
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  await sb.from("product_images").insert({ product_id: (p as any).id, path: pub.publicUrl, kind, sort: 1 });
  revalidatePath("/admin/media"); revalidatePath("/admin/catalogue");
  return { ok: true, url: pub.publicUrl };
}

export async function deleteProductImageAction(formData: FormData) {
  const id = String(formData.get("id"));
  await supabaseServer().from("product_images").delete().eq("id", id);
  revalidatePath("/admin/media"); revalidatePath("/shop");
}

export async function setHeroImageAction(formData: FormData) {
  const id = String(formData.get("id"));
  const productId = String(formData.get("productId"));
  const sb = supabaseServer();
  await sb.from("product_images").update({ sort: 2 }).eq("product_id", productId);
  await sb.from("product_images").update({ sort: -10 }).eq("id", id);
  revalidatePath("/admin/media"); revalidatePath("/shop");
}
