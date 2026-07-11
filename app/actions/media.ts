"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const BUCKET = "product-media";

export async function uploadProductImageAction(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, error: "Your role can't manage product photos." };
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
  // A product with a photo is "complete" — auto-publish it if it was still a draft.
  await sb.from("products").update({ status: "published" }).eq("id", (p as any).id).eq("status", "draft");
  revalidatePath("/admin/media"); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  return { ok: true, url: pub.publicUrl };
}

/**
 * EMERGENCY / manual override: upload a FINISHED photo and show it on the storefront immediately —
 * used when AI generation is unavailable (credits/API down) or the owner simply has a ready shot.
 * The image is stored as a storefront-visible 'model' image and made the product's PRIMARY (hero),
 * so it appears on the shop right away.
 */
export async function uploadStorefrontPhotoAction(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, error: "Your role can't manage product photos." };
  const sku = String(formData.get("sku") ?? "");
  const file = formData.get("image") as File | null;
  if (!file || typeof file !== "object" || file.size === 0) return { ok: false, error: "No image selected" };
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id, category:categories(slug)").eq("sku", sku).maybeSingle();
  if (!p) return { ok: false, error: "Product not found" };
  const productId = (p as any).id as string;
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
  const path = `${sku}/manual-${Date.now()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
  if (up.error) return { ok: false, error: up.error.message };
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  // Store as a storefront-visible image and make it the PRIMARY (hero) so it shows immediately.
  await sb.from("product_images").update({ sort: 2 }).eq("product_id", productId);
  await sb.from("product_images").insert({ product_id: productId, path: pub.publicUrl, kind: "model", sort: -10 });
  await sb.from("products").update({ status: "published" }).eq("id", productId).eq("status", "draft");
  const slug = (p as any).category?.slug;
  revalidatePath("/admin/media"); revalidatePath(`/admin/media/${productId}`); revalidatePath("/admin/catalogue"); revalidatePath("/shop");
  if (slug) revalidatePath(`/shop/${slug}/${sku}`);
  return { ok: true, url: pub.publicUrl };
}

export async function deleteProductImageAction(formData: FormData) {
  if (!(await requirePerm("catalog.ai"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  // Read the row first so we can also clear the product cover if it pointed at this exact photo —
  // otherwise the deleted image keeps showing as the cover ("deleted everywhere but cover stays").
  const { data: img } = await sb.from("product_images").select("product_id,path").eq("id", id).maybeSingle();
  await sb.from("product_images").delete().eq("id", id);
  if (img && (img as any).product_id && (img as any).path) {
    await sb.from("products").update({ thumbnail_path: null }).eq("id", (img as any).product_id).eq("thumbnail_path", (img as any).path);
  }
  revalidatePath("/admin/media"); revalidatePath("/shop"); revalidatePath("/admin/catalogue/[sku]", "page");
}

export async function setHeroImageAction(formData: FormData) {
  if (!(await requirePerm("catalog.ai"))) return;
  const id = String(formData.get("id"));
  const productId = String(formData.get("productId"));
  const sb = supabaseServer();
  await sb.from("product_images").update({ sort: 2 }).eq("product_id", productId);
  await sb.from("product_images").update({ sort: -10 }).eq("id", id);
  revalidatePath("/admin/media"); revalidatePath("/shop");
}
