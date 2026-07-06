"use server";
/**
 * AI product photo generation (Listing/Photo agent). Invoked ONLY by explicit buttons.
 * Takes the product's uploaded RAW photo as the exact reference, applies the locked
 * fidelity prompt, and produces an editorial model shot via Gemini (Nano Banana Pro).
 * The design must be reproduced exactly — fidelity is the whole point for a manufacturer.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { buildImagePrompt } from "@/lib/ai/imagePrompt";
import { generateImage, geminiConfigured } from "@/lib/ai/gemini";
import { requirePerm } from "@/lib/auth";

const BUCKET = "product-media";

export type GenResult = { ok: boolean; sku: string; reason?: string; error?: string; url?: string; prompt?: string };

export async function generateOneAction(sku: string, keywords?: string): Promise<GenResult> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, sku, reason: "not_permitted" };
  const p = await getProductBySku(sku);
  if (!p) return { ok: false, sku, reason: "not_found" };
  const index = parseInt(sku.replace(/\D/g, ""), 10) || 0;
  // Pull the product's REAL details into the prompt so Gemini frames the right jewellery type
  // (a necklace as a necklace, etc.) and knows the piece's name, colours and material — instead
  // of guessing from the reference alone. Category drives the worn-location; subcategory refines it.
  const gc = (p.generated_content as any) ?? {};
  const colours = ((p as any).variants ?? []).map((v: any) => v.color).filter(Boolean);
  const details = [
    ...(Array.isArray(gc.tags) ? gc.tags : []),
    ...(Array.isArray(gc.seo?.keywords) ? gc.seo.keywords : []),
    ...colours,
  ].filter(Boolean).slice(0, 8);
  const prompt = buildImagePrompt({
    category: (p as any).category?.name ?? p.category?.slug ?? "necklace",
    subcategory: (p as any).subcategory?.name ?? "",
    productName: p.name,
    details,
    keywords: (keywords ?? "").trim().slice(0, 120) || undefined,
    style: (p as any).subcategory?.image_style as ("auto" | "indian" | "western" | undefined),
    index,
    aspect: "4:5",
  });

  if (!geminiConfigured()) return { ok: false, sku, reason: "no_key", prompt };

  // The reference MUST be the owner's uploaded raw product photo.
  const ref = (p.images ?? []).find((i) => i.path.startsWith("http") && (i.kind === "source" || i.kind === "flatlay"));
  if (!ref) return { ok: false, sku, reason: "no_source", prompt };

  let referenceBase64: string, referenceMime = "image/jpeg";
  try {
    const r = await fetch(ref.path);
    referenceMime = r.headers.get("content-type") || "image/jpeg";
    referenceBase64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  } catch {
    return { ok: false, sku, reason: "no_source", prompt };
  }

  const result = await generateImage({ prompt, referenceBase64, referenceMime, aspectRatio: "4:5" });
  if (!result.ok) return { ok: false, sku, reason: result.reason, error: result.error, prompt };

  const sb = supabaseServer();
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const ext = result.mime.includes("png") ? "png" : "jpg";
  const path = `${sku}/model-${Date.now()}.${ext}`;
  const bytes = Buffer.from(result.base64, "base64");
  const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: result.mime, upsert: true });
  if (up.error) return { ok: false, sku, reason: "upload_failed: " + up.error.message, prompt };

  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  await sb.from("product_images").insert({ product_id: p.id, path: pub.publicUrl, kind: "model", sort: -1 });

  // The polished model shot becomes the PRIMARY (sort -1). We deliberately KEEP the raw
  // (source/flatlay) photo now — it is the ground-truth reference the "Fix a detail" editor
  // re-feeds to correct drifted details, so it must never be destroyed. Customers never see it:
  // every storefront image read hides kind 'source'/'flatlay' (isStorefrontImage in
  // lib/supabase/queries.ts), so only AI-generated images appear on the shop while the owner
  // still has the raw in the Photo Studio.

  revalidatePath(`/shop/${p.category.slug}/${sku}`);
  revalidatePath("/admin/catalogue");
  revalidatePath("/admin/media");
  revalidatePath("/shop");
  return { ok: true, sku, url: pub.publicUrl };
}

/** Extract the in-bucket object path from a Supabase public URL, or null if external. */
function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length));
}

export async function generateAllAction(): Promise<{ total: number; ok: number; needsKey: boolean; results: GenResult[] }> {
  const products = await getPublishedProducts();
  if (!geminiConfigured()) return { total: products.length, ok: 0, needsKey: true, results: products.map((p) => ({ ok: false, sku: p.sku, reason: "no_key" })) };
  const results: GenResult[] = [];
  for (const p of products) results.push(await generateOneAction(p.sku));
  revalidatePath("/admin/catalogue");
  return { total: products.length, ok: results.filter((r) => r.ok).length, needsKey: false, results };
}
