"use server";
/** AI product-page content generation (Listing Agent). Explicit button only — never on render. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { generateProductContent } from "@/lib/ai/listingAgent";
import { requirePerm } from "@/lib/auth";

export type ContentResult = { ok: boolean; sku: string; provider?: string; fallbackUsed?: boolean; title?: string; error?: string };

export async function generateContentAction(sku: string, keywords?: string[]): Promise<ContentResult> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, sku, error: "not permitted" };
  const p = await getProductBySku(sku);
  if (!p) return { ok: false, sku, error: "not found" };
  const colors = (p.variants ?? []).map((v) => v.color ?? "").filter(Boolean);
  const { content, provider, fallbackUsed } = await generateProductContent({
    name: p.name, sku: p.sku, categoryName: p.category?.name, colors,
    keywords: (keywords ?? []).map((k) => k.trim()).filter(Boolean),
  });
  const { error } = await supabaseServer().from("products").update({ generated_content: content }).eq("id", p.id);
  if (error) return { ok: false, sku, error: error.message };
  revalidatePath(`/shop/${p.category.slug}/${sku}`);
  revalidatePath("/admin/catalogue");
  return { ok: true, sku, provider, fallbackUsed, title: content.title };
}

/** Suggest a polished product title from a name + category (Req 6). Explicit button only. */
export async function suggestProductTitleAction(input: { name: string; category?: string; keywords?: string[] }): Promise<{ ok: boolean; title?: string; description?: string; provider?: string; fallbackUsed?: boolean; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, error: "Enter a product name first" };
  try {
    const { content, provider, fallbackUsed } = await generateProductContent({
      name, sku: name, categoryName: input.category, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
    });
    return { ok: true, title: content.title, description: content.description, provider, fallbackUsed };
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
