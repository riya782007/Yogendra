"use server";
/**
 * AI promotional-poster campaigns.
 *   1. refinePromoAction   — OpenAI turns the owner's rough idea into a detailed poster prompt
 *                            (grounded in the live catalogue) + a suggested category.
 *   2. generatePromoAction — Gemini (Nano Banana) renders the poster from the refined prompt,
 *                            stores it, and saves a DRAFT campaign.
 *   3. publishPromoAction  — the retail / wholesale toggles place the poster in the storefront hero,
 *                            targeted to the most-suited category.
 * All gated on `marketing.manage`. Best-effort + never throws to the client.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { refinePromoPrompt } from "@/lib/ai/promo";
import { openaiConfigured } from "@/lib/ai/providers";
import { generateImage, geminiConfigured } from "@/lib/ai/gemini";

const BUCKET = "product-media";

export async function refinePromoAction(input: { idea: string }): Promise<{ ok: boolean; title?: string; refinedPrompt?: string; categorySlug?: string | null; error?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "You don't have permission for promotions." };
  const idea = (input.idea ?? "").trim();
  if (!idea) return { ok: false, error: "Type your promotion idea first." };
  if (!openaiConfigured()) return { ok: false, error: "Add OPENAI_API_KEY to refine prompts with ChatGPT." };
  const sb = supabaseServer();
  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from("categories").select("name,slug").order("name"),
    sb.from("products").select("name,generated_content").eq("status", "published").limit(24),
  ]);
  const hints = ((prods as any[]) ?? [])
    .flatMap((p) => [p.name, ...(((p.generated_content as any)?.tags) ?? [])])
    .filter((x) => typeof x === "string" && x.trim());
  try {
    const brief = await refinePromoPrompt({ idea, categories: ((cats as any[]) ?? []), productHints: hints });
    return { ok: true, ...brief };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not refine the prompt." };
  }
}

export async function generatePromoAction(input: {
  refinedPrompt: string; title?: string; idea?: string; categorySlug?: string | null; aspect?: string; promotionId?: string;
}): Promise<{ ok: boolean; id?: string; url?: string; error?: string; reason?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "You don't have permission for promotions." };
  const prompt = (input.refinedPrompt ?? "").trim();
  if (!prompt) return { ok: false, error: "Refine or type a prompt first." };
  if (!geminiConfigured()) return { ok: false, error: "Add GEMINI_API_KEY (or OPENAI_API_KEY) to generate posters." };

  const aspect = input.aspect || "16:9";
  const result = await generateImage({ prompt, aspectRatio: aspect, timeoutMs: 120_000 });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error ?? "The image service is busy — try again." };

  const sb = supabaseServer();
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const ext = result.mime.includes("png") ? "png" : "jpg";
  const path = `promotions/${Date.now()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(result.base64, "base64"), { contentType: result.mime, upsert: true });
  if (up.error) return { ok: false, error: "Generated, but saving the poster failed. Try again." };
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

  let categoryId: string | null = null;
  if (input.categorySlug) {
    const { data: c } = await sb.from("categories").select("id").eq("slug", input.categorySlug).maybeSingle();
    categoryId = (c as any)?.id ?? null;
  }

  let id = input.promotionId;
  if (id) {
    await sb.from("promotions").update({
      image_path: pub.publicUrl, refined_prompt: prompt, title: input.title ?? null, prompt: input.idea ?? null,
      target_category_id: categoryId, aspect, provider: result.model,
    }).eq("id", id);
  } else {
    const { data: row } = await sb.from("promotions").insert({
      image_path: pub.publicUrl, refined_prompt: prompt, title: input.title ?? "Festive Campaign", prompt: input.idea ?? null,
      target_category_id: categoryId, aspect, provider: result.model, status: "draft", created_by: "owner",
    }).select("id").maybeSingle();
    id = (row as any)?.id;
  }
  await logActivity({ action: "promo_generated", ref: id ?? "", detail: input.title ?? "" });
  revalidatePath("/admin/promotions");
  return { ok: true, id, url: pub.publicUrl };
}

/** Turn the retail / wholesale toggles on (or off) and place the poster in the storefront hero. */
export async function publishPromoAction(input: { id: string; showRetail: boolean; showWholesale: boolean; categorySlug?: string | null }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "not permitted" };
  if (!input.id) return { ok: false, error: "bad input" };
  const sb = supabaseServer();
  let slug: string | undefined;
  let categoryId: string | null | undefined;
  if (input.categorySlug) {
    const { data: c } = await sb.from("categories").select("id,slug").eq("slug", input.categorySlug).maybeSingle();
    categoryId = (c as any)?.id ?? null; slug = (c as any)?.slug;
  }
  const live = input.showRetail || input.showWholesale;
  const patch: any = {
    show_retail: input.showRetail, show_wholesale: input.showWholesale,
    status: live ? "published" : "draft",
    cta_href: slug ? `/shop/c/${slug}` : "/shop",
  };
  if (categoryId !== undefined) patch.target_category_id = categoryId;
  const { error } = await sb.from("promotions").update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  await logActivity({ action: "promo_published", ref: input.id, detail: `retail:${input.showRetail} wholesale:${input.showWholesale}` });
  revalidatePath("/shop"); revalidatePath("/wholesale"); revalidatePath("/admin/promotions");
  if (slug) revalidatePath(`/shop/c/${slug}`);
  return { ok: true };
}

/** Archive / restore a campaign (also clears its hero placement when not published). */
export async function setPromoStatusAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("marketing.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["draft", "published", "archived"].includes(status)) return;
  const patch: any = { status };
  if (status !== "published") { patch.show_retail = false; patch.show_wholesale = false; }
  await supabaseServer().from("promotions").update(patch).eq("id", id);
  revalidatePath("/admin/promotions"); revalidatePath("/shop"); revalidatePath("/wholesale");
}

export async function deletePromoAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("marketing.manage"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabaseServer().from("promotions").delete().eq("id", id);
  revalidatePath("/admin/promotions"); revalidatePath("/shop"); revalidatePath("/wholesale");
}
