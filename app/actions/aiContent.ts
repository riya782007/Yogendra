"use server";
/** AI product-page content generation (Listing Agent). Explicit button only — never on render. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { generateProductContent } from "@/lib/ai/listingAgent";
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
  // Groq (primary) is text-only and writes from the name + category + sub-category + style + keywords, so
  // when it's configured we skip the photo download — this keeps bulk "Generate all" fast and avoids timeouts.
  const img: { imageBase64?: string; imageMime?: string } = process.env.GROQ_API_KEY ? {} : await fetchProductImage(p);
  const { imageBase64, imageMime } = img;
  const { content, provider, fallbackUsed } = await generateProductContent({
    name: nameForAi(p.name, p.sku), sku: p.sku, categoryName: p.category?.name,
    subcategoryName: (p as any).subcategory?.name, styleName: (st as any)?.name, polishes, colors,
    keywords: (keywords ?? []).map((k) => k.trim()).filter(Boolean),
    imageBase64, imageMime,
  } as any);
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
    // If we know the product (editing an existing one), pull its uploaded photo + the
    // sub-category / style / polish so the AI writes the title from all of that, not just the name.
    let imageBase64: string | undefined, imageMime: string | undefined;
    let subcategoryName: string | undefined, styleName: string | undefined, polishes: string[] = [];
    const skuStr = (input.sku ?? "").trim();
    if (input.sku) {
      const p = await getProductBySku(input.sku);
      if (p) {
        // Groq (primary) is text-only → skip the photo download; otherwise feed the photo to the vision model.
        if (!process.env.GROQ_API_KEY) ({ imageBase64, imageMime } = await fetchProductImage(p));
        subcategoryName = (p as any).subcategory?.name;
        polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
        if ((p as any).style_id) {
          const { data: st } = await supabaseServer().from("styles").select("name").eq("id", (p as any).style_id).maybeSingle();
          styleName = (st as any)?.name;
        }
      }
    }
    const { content, provider, fallbackUsed } = await generateProductContent({
      name: nameForAi(name, skuStr), sku: input.sku || name, categoryName: input.category,
      subcategoryName, styleName, polishes, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      imageBase64, imageMime,
    });
    const cleanTitle = stripCode(content.title, skuStr) || content.title;
    return { ok: true, title: cleanTitle, description: content.description, provider, fallbackUsed, usedImage: !!imageBase64 };
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
