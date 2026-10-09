"use server";
/** AI product-page content generation (Listing Agent). Explicit button only — never on render. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getProductBySku, getPublishedProducts } from "@/lib/supabase/queries";
import { generateProductContent, generateTitleOptions, fallbackProductContent } from "@/lib/ai/listingAgent";
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
    // 4s, not 12s. The whole serverless function is killed at 10s, so a 12-second image download
    // could never finish AND leave time for the model — it just guaranteed the request died with
    // nothing to show. Failing fast returns {} and the caller writes copy from the fields instead,
    // which is a worse title but an actual answer. (Applies to every "read the photo" path here.)
    const r = await fetch(pick.path, { signal: AbortSignal.timeout(4_000) });
    if (!r.ok) return {};
    const imageMime = r.headers.get("content-type") || "image/jpeg";
    const imageBase64 = Buffer.from(await r.arrayBuffer()).toString("base64");
    return { imageBase64, imageMime };
  } catch {
    return {};
  }
}

/**
 * "Generate AI page" — ROOT CAUSE OF "AI page generator is not working" (Oct 2026)
 * ============================================================================================
 * Same trap as alignContentToTitleAction below. Worst case for one product used to be:
 *     photo download 4 s  +  vision model 30 s (+1 retry 30 s)  +  second provider 30 s  +  groq 18 s
 * Netlify kills a server action at 10 s, so on any slow model the request died, nothing was saved and
 * the button just "did nothing". "Generate all AI pages" looped EVERY published product inside ONE
 * request, so it could never finish at all.
 *
 * Now every call fits a hard budget (GEN_BUDGET_MS, well under 10 s):
 *   1. read the photo (≤ 2.5 s) and ask the vision model, until ~5.5 s in;
 *   2. if that hasn't answered, a fast text-only model (from name, category, style, polish, colours);
 *   3. if even that is too slow: a product that has NO page yet gets the standard written-from-fields
 *      page (clearly marked as such in the result); a product that already HAS a page keeps it — a slow
 *      model must never overwrite good copy with a template.
 */
const GEN_BUDGET_MS = 8_000;
const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
  ms <= 0 ? Promise.resolve(null)
    : Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);

export async function generateContentAction(sku: string, keywords?: string[]): Promise<ContentResult> {
  const t0 = Date.now();
  const left = () => GEN_BUDGET_MS - (Date.now() - t0);
  if (!(await requirePerm("catalog.ai"))) return { ok: false, sku, error: "not permitted" };
  const p = await getProductBySku(sku);
  if (!p) return { ok: false, sku, error: "not found" };
  const sb = supabaseServer();
  const colors = (p.variants ?? []).map((v) => v.color ?? "").filter(Boolean);
  const polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
  const { data: st } = (p as any).style_id ? await sb.from("styles").select("name").eq("id", (p as any).style_id).maybeSingle() : { data: null as any };
  const fields = {
    name: nameForAi(p.name, p.sku), sku: p.sku, categoryName: p.category?.name,
    subcategoryName: (p as any).subcategory?.name, styleName: (st as any)?.name, polishes, colors,
    keywords: (keywords ?? []).map((k) => k.trim()).filter(Boolean),
  };

  // Start the fast text-only model AT ONCE and, in parallel, read the photo and ask the vision model.
  // Use the vision answer if it lands in time (better: it has seen the piece), else the text one.
  // (Before: vision got ~5 s, then text only the ~2 s left — so on any slow minute both missed.)
  const errors: string[] = [];
  const onLog = (e: any) => { if (e && e.ok === false && e.error) errors.push(`${e.provider}: ${String(e.error).slice(0, 140)}`); };
  const isReal = (r: any) => r && r.provider !== "deterministic";
  const textP = generateProductContent(fields as any, { visionFirst: false, timeoutMs: Math.max(1_500, left() - 900), onLog }).catch(() => null);
  const img = (await within(fetchProductImage(p), Math.min(2_500, left() - 4_500))) ?? {};
  const visionP = img.imageBase64
    ? generateProductContent({ ...fields, imageBase64: img.imageBase64, imageMime: img.imageMime } as any,
        { visionFirst: true, imageDetail: "low", timeoutMs: Math.max(1_500, left() - 1_200), onLog }).catch(() => null)
    : null;
  let res: Awaited<ReturnType<typeof generateProductContent>> | null = null;
  if (visionP) { const v = await within(visionP, left() - 1_200); if (isReal(v)) res = v; }
  if (!res) { const t = await within(textP, left() - 500); if (isReal(t)) res = t; }
  if (!res) {
    if ((p as any).generated_content?.title) {
      // Keep good copy rather than overwrite it with a template — and say WHY nothing came back.
      const why = errors.length ? ` (${[...new Set(errors)].join("; ")})` : "";
      return { ok: false, sku, error: errors.length
        ? `The AI service returned an error, so the existing page was kept${why}.`
        : "The AI took too long — the existing page was kept. Try again in a minute." };
    }
    res = fallbackProductContent(fields as any);
  }
  const { content, provider, fallbackUsed } = res;
  content.title = stripCode(content.title, p.sku) || content.title;
  // The shop's own sub-category / category is the truth for "what is this" — the model sometimes
  // reads a photo of a hair choti on a bride as a "Necklace Set" (Oct 2026). Pin specs.Category to it.
  const shopType = ((p as any).subcategory?.name || p.category?.name || "").trim();
  if (shopType && !/^(jewell?ery|all|others?|misc\w*)$/i.test(shopType)) {
    content.specs = { ...(content.specs ?? {}), Category: shopType };
  }
  // Mark who wrote it, so the store can show the "written with AI" note on AI pages only.
  content.source = provider === "template" ? "template" : "ai";
  content.generatedAt = new Date().toISOString();
  const { error } = await sb.from("products").update({ generated_content: content }).eq("id", p.id);
  if (error) return { ok: false, sku, error: error.message };
  revalidatePath(`/shop/${p.category.slug}/${sku}`);
  revalidatePath("/admin/catalogue");
  return { ok: true, sku, provider, fallbackUsed, title: content.title };
}

/** SKUs of published products that have no AI page yet — the "write missing pages" button walks
 *  this list ONE product per request, so each request fits the host's 10-second limit. */
export async function listProductsMissingAiAction(): Promise<{ skus: string[]; total: number }> {
  if (!(await requirePerm("catalog.ai"))) return { skus: [], total: 0 };
  const products = await getPublishedProducts();
  const skus = products.map((p: any) => p.sku);
  if (!skus.length) return { skus: [], total: 0 };
  const sb = supabaseServer();
  const have = new Set<string>();
  for (let i = 0; i < skus.length; i += 300) {
    const { data } = await sb.from("products").select("sku,generated_content").in("sku", skus.slice(i, i + 300));
    for (const r of ((data as any[]) ?? [])) if (r.generated_content?.title) have.add(r.sku);
  }
  const missing = skus.filter((s: string) => !have.has(s));
  return { skus: missing, total: skus.length };
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

/**
 * Rewrite the DESCRIPTION to match a title the owner just picked.
 *
 * ROOT CAUSE OF "title pick krne ke baad it too slow / Saving… struck" (Sept 2026)
 * ============================================================================================
 * This action used to re-read the product photo and run a VISION model on it. Count the budget it
 * was given, against the host it runs on:
 *
 *     fetchProductImage()                    up to 12,000 ms   (AbortSignal.timeout(12_000))
 *     vision model call                      up to 30,000 ms   (providers.ts: imageBase64 ? 30_000)
 *     ------------------------------------------------------------------
 *     worst case                             ~42 s
 *     Netlify kills a synchronous function at 10 s.
 *
 * So on a slow photo or a slow model this action COULD NOT finish — the function was killed
 * mid-flight, the server action never returned, and the owner sat watching "Saving…" forever. It
 * was never a UI bug; the work was configured for a long-running server and deployed onto a
 * 10-second one.
 *
 * TWO CHANGES, both about fitting the host:
 *
 * 1. NO VISION HERE. The photo is what "Suggest 3-4 titles" reads, and by this point the owner has
 *    ALREADY picked the title it produced — the title itself states what the piece is. Re-reading
 *    the image to write a matching paragraph buys almost nothing and costs the 12s download plus
 *    the vision premium. This is now a text-only call built from the title, category, sub-category,
 *    style and polishes.
 *
 * 2. A HARD BUDGET. Whatever happens, this returns inside BUDGET_MS — comfortably under the host's
 *    limit — so the owner always gets an answer instead of a dead request. If the model is slow he
 *    gets his title with a clear note to write the description himself, which is a normal minute of
 *    work; before, he got a stuck page and an unsaved product.
 */
const ALIGN_BUDGET_MS = 4_000;

export async function alignContentToTitleAction(input: { sku?: string; name?: string; category?: string; title: string; keywords?: string[] }): Promise<{ ok: boolean; title?: string; description?: string; provider?: string; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const chosen = (input.title ?? "").trim();
  if (!chosen) return { ok: false, error: "No title chosen" };
  const skuStr = (input.sku ?? "").trim();

  const work = (async () => {
    let subcategoryName: string | undefined, styleName: string | undefined, polishes: string[] = [];
    if (input.sku) {
      const p = await getProductBySku(input.sku);
      if (p) {
        subcategoryName = (p as any).subcategory?.name;
        polishes = (p.variants ?? []).map((v: any) => v.polish ?? "").filter(Boolean);
        if ((p as any).style_id) {
          const { data: st } = await supabaseServer().from("styles").select("name").eq("id", (p as any).style_id).maybeSingle();
          styleName = (st as any)?.name;
        }
      }
    }
    // No imageBase64 and no visionFirst — see note above.
    const { content, provider } = await generateProductContent({
      name: nameForAi(input.name ?? chosen, skuStr), sku: input.sku || chosen, categoryName: input.category,
      subcategoryName, styleName, polishes, colors: [],
      keywords: (input.keywords ?? []).map((k) => k.trim()).filter(Boolean),
      lockedTitle: chosen,
    } as any);
    return { ok: true as const, title: chosen, description: content.description, provider };
  })();

  const timeout = new Promise<{ ok: false; title: string; error: string }>((resolve) =>
    setTimeout(() => resolve({
      ok: false,
      title: chosen,
      error: "The title is set, but the description took too long to write — please type it yourself and Save.",
    }), ALIGN_BUDGET_MS),
  );

  try {
    return await Promise.race([work, timeout]);
  } catch (e) {
    return { ok: false, title: chosen, error: e instanceof Error ? e.message : "Could not write the description" };
  }
}

/** Kept for the old server form: now writes pages only for products that have none, and stops before
 *  the host's time limit (it used to loop every product in one request and was always killed). The
 *  catalogue button uses listProductsMissingAiAction + generateContentAction per product instead. */
export async function generateAllContentAction(): Promise<{ total: number; ok: number; results: ContentResult[] }> {
  const t0 = Date.now();
  const { skus } = await listProductsMissingAiAction();
  const results: ContentResult[] = [];
  for (const sku of skus) {
    if (Date.now() - t0 > 1_000) break; // one product per request keeps every call inside the limit
    results.push(await generateContentAction(sku));
  }
  revalidatePath("/admin/catalogue");
  return { total: skus.length, ok: results.filter((r) => r.ok).length, results };
}

/** Implementation moved to fixNath.ts (broader match). */
export async function fixNathListingsAction() {
  const { fixNathListingsAction: run } = await import("@/app/actions/fixNath");
  return run();
}
