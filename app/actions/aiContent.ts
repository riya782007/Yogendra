"use server";
/** AI product-page content generation (Listing Agent). Explicit button only — never on render. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { generateProductContent } from "@/lib/ai/listingAgent";
import { requirePerm } from "@/lib/auth";

export type ContentResult = { ok: boolean; sku: string; provider?: string; fallbackUsed?: boolean; title?: string; error?: string };

/**
 * Downloads the product's best available photo and returns it as base64 so the AI can
 * SEE the piece while writing the title & description. Prefers the owner's raw/source
 * photo, then the AI model shot, then any http image. Best-effort — returns undefined
 * on any failure so title generation still works without a picture.
 */
async function fetchProductImage(p: any): Promise<{ imageBase64?: string; imageMime?: string }> {
  try {
    const imgs = (p.images ?? []).filter((i: any) => typeof i?.path === "string" && i.path.startsWith("http"));
    if (!imgs.length) return {};
    const pick =
      imgs.find((i: any) => i.kind === "source" || i.kind === "flatlay") ??
      imgs.find((i: any) => i.kind === "model") ??
      imgs[0];
    const r = await fetch(pick.path, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) return {};
    const imageMime = r.headers.get("content-type") || "image/jpeg";
    const imageBase64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    return { imageBase64, imageMime };
  } catch {
    return {};
  }
}

export async function generateContentAction(sku: string, keywords?: string[]): Promise<ContentResult> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, sku, error: "not permitted" };
  const p = await getProductBySku(sku);
  if (!p) return { ok: false, sku, error: "not found" };
  const colors = (p.variants ?? []).map((v) => v.color ?? "").filter(Boolean);
  const { imageBase64, imageMime } = await fetchProductImage(p);
  const { content, provider, fallbackUsed } = await generateProductContent({
    name: p.name, sku: p.sku, categoryName: p.category?.name, colors,
    keywords: (keywords ?? []).map((k) => k.trim()).filter(Boolean),
    imageBase64, imageMime,
  });
  const { error } = await supabaseServer().from("products").update({ generated_content: content }).eq("id", p.id);
  if (error) return { ok: false, sku, error: error.message };
  revalidatePath(`/shop/${p.category.slug}/${sku}`);
  revalidatePath("/admin/catalogue");
  return { ok: true, sku, provider, fallbackUsed, title: content.title };
}

/** Suggest a polished product title from a name + category (Req 6). Explicit button only. */
export async function suggestProductTitleAction(input: { name: string; category?: string; keywords?: string[]; sku?: string }): Promise<{ ok: boolean; title?: string; description?: string; provider?: string; fallbackUsed?: boolean; usedImage?: boolean; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter a product name first" };
  try {
    // If we know the product (editing an existing one), pull its uploaded photo so the AI
    // writes the title & description from what the piece actually looks like.
    let imageBase64: string | undefined, imageMime: string | undefined;
    if (input.sku) {
      const p = await getProductBySku(input.sku);
      if (p) ({ imageBase64, imageMime } = await fetchProductImage(p));
    }
    const { content, provider, fallbackUsed } = await generateProductContent({
      name, sku: input.sku || name, categoryName: input.category, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      imageBase64, imageMime,
    });
    return { ok: true, title: content.title, description: content.description, provider, fallbackUsed, usedImage: !!imageBase64 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not suggest a title" };
  }
}

export async function generateAllContentAction(): Promise<{ total: number; ok: number; results: ContentResult[] }> {
  const products = await getPublishedProducts();
  const results: ContentResult[] = [];
  for (const p of products) results.push(await generateContentAction(p.sku));
  revalidatePath("/admin/catalogue");
  return { total: products.length, ok: results.filter((r) => r.ok).length, results };
}
