"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const BUCKET = "product-media";

export async function createReelAction(formData: FormData) {
  if (!(await requirePerm("reels.manage"))) return;
  const caption = String(formData.get("caption") ?? "").trim();
  let videoUrl = String(formData.get("video_url") ?? "").trim() || null;
  const skus = String(formData.get("skus") ?? "").split(/[, \n]+/).map((s) => s.trim()).filter(Boolean);
  if (!caption) return;
  const sb = supabaseServer();

  // If a video file was uploaded, store it and use its public URL (so it autoplays on-site).
  const file = formData.get("video") as File | null;
  if (file && typeof file === "object" && file.size > 0) {
    await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
    const ext = ((file.type.split("/")[1]) || "mp4").replace("quicktime", "mov");
    const path = `reels/${Date.now()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "video/mp4", upsert: true });
    if (!up.error) videoUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const { data: reel } = await sb.from("reels").insert({ caption, video_url: videoUrl, ig_id: `IG_${Date.now()}`, posted_at: new Date().toISOString() }).select("id").single();
  if (reel && skus.length) {
    const { data: prods } = await sb.from("products").select("id,sku").in("sku", skus);
    const rows = ((prods as any[]) ?? []).map((p) => ({ reel_id: reel.id, product_id: p.id }));
    if (rows.length) await sb.from("reel_products").insert(rows);
  }
  revalidatePath("/admin/reels"); revalidatePath("/reels"); revalidatePath("/shop");
}

export async function deleteReelAction(formData: FormData) {
  if (!(await requirePerm("reels.manage"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("reels").delete().eq("id", id);
  revalidatePath("/admin/reels"); revalidatePath("/reels"); revalidatePath("/shop");
}
