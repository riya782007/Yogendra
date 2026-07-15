"use server";
/** AI product-page content generation (Listing Agent). Explicit button only — never on render. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { generateProductContent, generateTitleOptions } from "@/lib/ai/listingAgent";
import { requirePerm } from "@/lib/auth";

export type ContentResult = { ok: boolean; sku: string; provider?: string; fallbackUsed?: boolean; title?: string; error?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The name to hand the AI: strip the SKU; if only a bare code remains, return "" so the AI builds the
 *  title purely from category / sub-category / style / polish (never echoes "WN111" into the title). */
function nameForAi(name: string | null | undefined, sku: string): string {
  let n = (name ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  if (sku) n = n.replace(new RegExp(`\\b${esc(sku)}\\b`, "ig"), " ");
  n = n.replace(/\s+/g, " ").trim();
  return /^[A-Za-z]{1,4}[-\s]?\d{1,6}[A-Za-z]?$/.test(n) ? "" : n;
}
/** Safety net: strip the SKU and any leaked product-code token (e.g. "WN111") out of a generated title. */
function stripCode(title: string | undefined, sku: string): string {
  let t = title ?? "";
  if (sku) t = t.replace(new RegExp(`\\b${esc(sku)}\\b`, "ig"), " ");
  t = t.replace(/\b[A-Za-z]{1,4}\d{1,6}[A-Za-z]?\b/g, " ");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s\-–|]+|[\s\-–|]+$/g, "").trim();
}

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
  const sb = supabaseServer();
  const colors = (p.variants ?? []).map((v) => v.color ?? "").filter(Boolean);
  const polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
  // Pull the STYLE name too so the AI can build the title from category + sub-category + style + polish.
  const { data: st } = (p as any).style_id ? await sb.from("styles").select("name").eq("id", (p as any).style_id).maybeSingle() : { data: null as any };
  // Look at the ACTUAL product photo (like the owner does in ChatGPT) so the title/description describe
  // the real piece — the text-only path was guessing wrong pieces (e.g. "Mangalsutra") from the category.
  const img = await fetchProductImage(p);
  const { content, provider, fallbackUsed } = await generateProductContent({
    name: nameForAi(p.name, p.sku), sku: p.sku, categoryName: p.category?.name,
    subcategoryName: (p as any).subcategory?.name, styleName: (st as any)?.name, polishes, colors,
    keywords: (keywords ?? []).map((k) => k.trim()).filter(Boolean),
    imageBase64: img.imageBase64, imageMime: img.imageMime,
  } as any, { visionFirst: true });
  content.title = stripCode(content.title, p.sku) || content.title; // never let a SKU/code leak into the title
  const { error } = await sb.from("products").update({ generated_content: content }).eq("id", p.id);
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
    // Look at the ACTUAL product photo (exactly like the owner does in ChatGPT — "take reference from the
    // image") so the title/description describe the real piece. The text-only path was inventing wrong
    // components (e.g. a "Mangalsutra" that isn't there). Owner-typed keywords still override the photo.
    let subcategoryName: string | undefined, styleName: string | undefined, polishes: string[] = [];
    let imageBase64: string | undefined, imageMime: string | undefined;
    const skuStr = (input.sku ?? "").trim();
    if (input.sku) {
      const p = await getProductBySku(input.sku);
      if (p) {
        subcategoryName = (p as any).subcategory?.name;
        polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
        if ((p as any).style_id) {
          const { data: st } = await supabaseServer().from("styles").select("name").eq("id", (p as any).style_id).maybeSingle();
          styleName = (st as any)?.name;
        }
        const img = await fetchProductImage(p);
        imageBase64 = img.imageBase64; imageMime = img.imageMime;
      }
    }
    const { content, provider, fallbackUsed } = await generateProductContent({
      name: nameForAi(name, skuStr), sku: input.sku || name, categoryName: input.category,
      subcategoryName, styleName, polishes, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      imageBase64, imageMime,
    } as any, { visionFirst: true });
    const cleanTitle = stripCode(content.title, skuStr) || content.title;
    return { ok: true, title: cleanTitle, description: content.description, provider, fallbackUsed, usedImage: !!imageBase64 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not suggest a title" };
  }
}

/** Suggest 3–4 SEO title OPTIONS by scanning the product photo + its taxonomy (owner picks one). */
export async function suggestProductTitlesAction(input: { name: string; category?: string; keywords?: string[]; sku?: string; count?: number }): Promise<{ ok: boolean; titles?: string[]; provider?: string; usedImage?: boolean; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const name = (input.name ?? "").trim();
  const skuStr = (input.sku ?? "").trim();
  try {
    let subcategoryName: string | undefined, styleName: string | undefined, polishes: string[] = [];
    let imageBase64: string | undefined, imageMime: string | undefined;
    if (input.sku) {
      const p = await getProductBySku(input.sku);
      if (p) {
        subcategoryName = (p as any).subcategory?.name;
        polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
        if ((p as any).style_id) {
          const { data: st } = await supabaseServer().from("styles").select("name").eq("id", (p as any).style_id).maybeSingle();
          styleName = (st as any)?.name;
        }
        const img = await fetchProductImage(p);
        imageBase64 = img.imageBase64; imageMime = img.imageMime;
      }
    }
    const { titles, provider, usedImage } = await generateTitleOptions({
      name: nameForAi(name, skuStr), sku: input.sku || name, categoryName: input.category,
      subcategoryName, styleName, polishes, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      imageBase64, imageMime,
    } as any, Math.min(4, Math.max(3, input.count ?? 4)));
    const clean = titles.map((t) => stripCode(t, skuStr) || t).filter(Boolean);
    if (!clean.length) return { ok: false, error: "Couldn't suggest titles — try adding a photo or a keyword." };
    return { ok: true, titles: clean, provider, usedImage };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not suggest titles" };
  }
}

/** After the owner PICKS a suggested title, write the matching description/specs/tags/SEO aligned to it
 *  (the chosen title becomes the product's title verbatim). Returns the aligned copy for the editor. */
export async function alignContentToTitleAction(input: { sku?: string; name?: string; category?: string; title: string; keywords?: string[] }): Promise<{ ok: boolean; title?: string; description?: string; provider?: string; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const chosen = (input.title ?? "").trim();
  if (!chosen) return { ok: false, error: "No title chosen" };
  const skuStr = (input.sku ?? "").trim();
  try {
    let subcategoryName: string | undefined, styleName: string | undefined, polishes: string[] = [];
    let imageBase64: string | undefined, imageMime: string | undefined;
    if (input.sku) {
      const p = await getProductBySku(input.sku);
      if (p) {
        subcategoryName = (p as any).subcategory?.name;
        polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
        if ((p as any).style_id) {
          const { data: st } = await supabaseServer().from("styles").select("name").eq("id", (p as any).style_id).maybeSingle();
          styleName = (st as any)?.name;
        }
        const img = await fetchProductImage(p);
        imageBase64 = img.imageBase64; imageMime = img.imageMime;
      }
    }
    const { content, provider } = await generateProductContent({
      name: nameForAi(input.name ?? chosen, skuStr), sku: input.sku || chosen, categoryName: input.category,
      subcategoryName, styleName, polishes, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      imageBase64, imageMime, lockedTitle: chosen,
    } as any, { visionFirst: true });
    return { ok: true, title: chosen, description: content.description, provider };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not write the description" };
  }
}

export async function generateAllContentAction(): Promise<{ total: number; ok: number; results: ContentResult[] }> {
  const products = await getPublishedProducts();
  const results: ContentResult[] = [];
  for (const p of products) results.push(await generateContentAction(p.sku));
  revalidatePath("/admin/catalogue");
  return { total: products.length, ok: results.filter((r) => r.ok).length, results };
}
