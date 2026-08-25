"use server";
/** AI product-page content generation (Listing Agent). Explicit button only — never on render. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { generateProductContent, generateTitleOptions } from "@/lib/ai/listingAgent";
import { requirePerm } from "@/lib/auth";

export type ContentResult = { ok: boolean; sku: string; provider?: string; fallbackUsed?: boolean; title?: string; error?: string };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function nameForAi(name: string | null | undefined, sku: string): string {
  let n = (name ?? "").replace(/\s*\([^)]*\)\s*$/, "");
  if (sku) n = n.replace(new RegExp(`\\b${esc(sku)}\\b`, "ig"), " ");
  n = n.replace(/\s+/g, " ").trim();
  return /^[A-Za-z]{1,4}[-\s]?\d{1,6}[A-Za-z]?$/.test(n) ? "" : n;
}
function stripCode(title: string | undefined, sku: string): string {
  let t = title ?? "";
  if (sku) t = t.replace(new RegExp(`\\b${esc(sku)}\\b`, "ig"), " ");
  t = t.replace(/\b[A-Za-z]{1,4}\d{1,6}[A-Za-z]?\b/g, " ");
  return t.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").replace(/^[\s\-–|]+|[\s\-–|]+$/g, "").trim();
}

async function fetchProductImage(p: any): Promise<{ imageBase64?: string; imageMime?: string }> {
  try {
    const prodImgs = (p.images ?? []).filter((i: any) => typeof i?.path === "string" && i.path.startsWith("http"));
    const varImgs = ((p.variants ?? []) as any[]).flatMap((v: any) =>
      (((v.image_paths ?? []) as string[]) || [])
        .filter((u) => typeof u === "string" && u.startsWith("http"))
        .map((path) => ({ path, kind: "variant" })));
    const imgs = [...prodImgs, ...varImgs];
    if (!imgs.length) return {};
    const pick =
      prodImgs.find((i: any) => i.kind === "source" || i.kind === "flatlay") ??
      prodImgs.find((i: any) => i.kind === "model") ??
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
  const { data: st } = (p as any).style_id ? await sb.from("styles").select("name").eq("id", (p as any).style_id).maybeSingle() : { data: null as any };
  const img = await fetchProductImage(p);
  const { content, provider, fallbackUsed } = await generateProductContent({
    name: nameForAi(p.name, p.sku), sku: p.sku, categoryName: p.category?.name,
    subcategoryName: (p as any).subcategory?.name, styleName: (st as any)?.name, polishes, colors,
    keywords: (keywords ?? []).map((k) => k.trim()).filter(Boolean),
    imageBase64: img.imageBase64, imageMime: img.imageMime,
  } as any, { visionFirst: true });
  content.title = stripCode(content.title, p.sku) || content.title;
  const { error } = await sb.from("products").update({ generated_content: content }).eq("id", p.id);
  if (error) return { ok: false, sku, error: error.message };
  revalidatePath(`/shop/${p.category.slug}/${sku}`);
  revalidatePath("/admin/catalogue");
  return { ok: true, sku, provider, fallbackUsed, title: content.title };
}

export async function suggestProductTitleAction(input: { name: string; category?: string; keywords?: string[]; sku?: string }): Promise<{ ok: boolean; title?: string; description?: string; provider?: string; fallbackUsed?: boolean; usedImage?: boolean; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter a product name first" };
  try {
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

/** Implementation moved to fixNath.ts (broader match). */
export async function fixNathListingsAction() {
  const { fixNathListingsAction: run } = await import("@/app/actions/fixNath");
  return run();
}
