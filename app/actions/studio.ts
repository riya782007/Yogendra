"use server";
/**
 * AI Jewellery Photography Studio actions.
 * Generation is NON-DESTRUCTIVE: every Regenerate appends a new `image_generations` candidate;
 * nothing is overwritten. Publishing a candidate copies its URL into product_images (the
 * storefront source), so retail + wholesale + category + search update automatically.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";
import { buildStudioPrompt, buildRefinePrompt, SHOT_META, type ShotType, type StudioSettings } from "@/lib/ai/imagePrompt";
import { generateImage, editImage, geminiConfigured } from "@/lib/ai/gemini";
import { detectJewellery } from "@/lib/ai/detect";

const BUCKET = "product-media";

export type GenOut = { ok: boolean; error?: string; reason?: string; id?: string; url?: string; provider?: string };

async function fetchAsBase64(url: string): Promise<{ base64: string; mime: string } | null> {
  try {
    const r = await fetch(url);
    const mime = r.headers.get("content-type") || "image/jpeg";
    return { base64: Buffer.from(await r.arrayBuffer()).toString("base64"), mime };
  } catch { return null; }
}

/** Generate ONE candidate for a shot type with optional art-direction settings. Appends; never overwrites. */
export async function generateStudioImageAction(input: {
  productId: string; shotType: ShotType; settings?: StudioSettings; variantId?: string;
  style?: "auto" | "indian" | "western";
  /** true = recolour the piece to the variant's colour NAME; default/false = trust the raw photo. */
  matchColorName?: boolean;
}): Promise<GenOut> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, reason: "not_permitted" };
  const { productId, shotType } = input;
  if (!productId || !shotType) return { ok: false, reason: "bad_input" };
  const sb = supabaseServer();

  // Keep the product fetch MINIMAL and robust — do NOT embed subcategories here: if that relation
  // is even slightly out of sync in the deployed DB, the whole query returns null and generation
  // wrongly reports "Product not found". Subcategory is loaded separately & guarded below.
  const { data: p } = await sb.from("products")
    .select("id,sku,name,subcategory_id, category:categories(name,slug)")
    .eq("id", productId).maybeSingle();
  if (!p) return { ok: false, reason: "not_found" };
  const prod = p as any;

  // Best-effort subcategory (name + AI model style). Wrapped so any failure leaves generation working,
  // just falling back to the parent category for framing.
  let sub: { name?: string; image_style?: string } = {};
  if (prod.subcategory_id) {
    try {
      const { data: sc } = await sb.from("subcategories").select("name,image_style").eq("id", prod.subcategory_id).maybeSingle();
      if (sc) sub = sc as any;
    } catch { /* ignore — category framing still applies */ }
  }
  prod.subcategory = sub;

  // When a variant is chosen, prefer THAT colour's own photo as the reference so the AI reproduces
  // the exact colourway. Fall back to the product's raw upload / any product image otherwise.
  let variantColor: string | null = null;
  let refUrl: string | null = null;
  if (input.variantId) {
    const { data: v } = await sb.from("variants").select("color,image_paths").eq("id", input.variantId).maybeSingle();
    variantColor = (v as any)?.color ?? null;
    const vImgs = (v as any)?.image_paths;
    // Prefer the MOST RECENTLY uploaded variant photo, so an "Upload raw" the owner just added is
    // the one the AI works from (uploads append to the end of image_paths).
    const httpImgs = Array.isArray(vImgs) ? vImgs.filter((x: string) => typeof x === "string" && x.startsWith("http")) : [];
    refUrl = httpImgs.length ? httpImgs[httpImgs.length - 1] : null;
  }
  if (!refUrl) {
    const { data: imgs } = await sb.from("product_images").select("id,path,kind").eq("product_id", productId);
    const all = ((imgs as any[]) ?? []).filter((i) => typeof i.path === "string" && i.path.startsWith("http"));
    refUrl = (all.find((i) => i.kind === "source" || i.kind === "flatlay") ?? all[0])?.path ?? null;
  }
  if (!refUrl) return { ok: false, reason: "no_source" };

  if (!geminiConfigured()) return { ok: false, reason: "no_key" };

  // Auto-detect the piece (Gemini vision → keyword fallback). NOTE: `hint` is ONLY used to help
  // the detector — it is never passed as the authoritative category/subcategory (that comes from
  // the product record below), so a mis-detection can never turn a necklace into a bangle.
  const hint = [prod.name, prod.category?.name, prod.subcategory?.name, variantColor].filter(Boolean).join(" ");
  const detected = await detectJewellery({ imageUrl: refUrl, hint, knownCategory: prod.subcategory?.name || prod.category?.name });

  // The product's OWN category/subcategory/name/style is the ground truth for how the piece must be
  // framed and worn — Gemini's vision guess (`detected`) may only add material/style flavour, never
  // override where the piece sits on the body.
  const { prompt, aspect } = buildStudioPrompt({
    category: prod.category?.name ?? "necklace",
    subcategory: prod.subcategory?.name ?? "",
    productName: prod.name,
    variantColor: variantColor ?? undefined,
    forceColour: input.matchColorName === true,
    shotType,
    settings: input.settings,
    detected,
    style: (input.style ?? (prod.subcategory?.image_style as ("auto" | "indian" | "western" | undefined))),
  });

  const refImg = await fetchAsBase64(refUrl);
  const result = await generateImage({ prompt, referenceBase64: refImg?.base64, referenceMime: refImg?.mime, aspectRatio: aspect });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  // Upload candidate.
  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const ext = result.mime.includes("png") ? "png" : "jpg";
  const path = `${prod.sku}/${shotType}-${Date.now()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(result.base64, "base64"), { contentType: result.mime, upsert: true });
  if (up.error) return { ok: false, reason: "upload_failed", error: up.error.message };
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

  // Version = next per (product, shot_type).
  const { count } = await sb.from("image_generations").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("shot_type", shotType);
  const version = (count ?? 0) + 1;

  const { data: row } = await sb.from("image_generations").insert({
    product_id: productId, variant_id: input.variantId ?? null, raw_image_path: refUrl, output_path: pub.publicUrl,
    shot_type: shotType, prompt, settings: input.settings ?? {}, detected, provider: result.model, version,
    status: "candidate", created_by: "owner",
  }).select("id").maybeSingle();

  await logActivity({ action: "photo_generated", ref: prod.sku, detail: `${shotType} v${version} (${result.model})` });
  revalidatePath(`/admin/media/${productId}`);
  return { ok: true, id: (row as any)?.id, url: pub.publicUrl, provider: result.model };
}

/**
 * Refine (surgical "fix a detail") — the owner marks a wrong area on a generated candidate and
 * types what it should be. We edit ONLY that region, re-anchored to the ORIGINAL raw reference,
 * and save the result as a NEW candidate linked to its parent. NON-DESTRUCTIVE: the original
 * candidate is untouched, so the owner can compare and revert.
 *
 * `markedBase64` is the candidate image with the owner's outline drawn on it (composited in the
 * browser). `region` is the normalised {x,y,w,h} (0..1) of the marked box, stored for history.
 */
export async function refineGenerationAction(input: {
  generationId: string;
  instruction: string;
  markedBase64?: string;
  markedMime?: string;
  region?: { x: number; y: number; w: number; h: number } | null;
}): Promise<GenOut> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, reason: "not_permitted" };
  const instruction = (input.instruction ?? "").trim();
  if (!input.generationId || !instruction) return { ok: false, reason: "bad_input" };
  if (!geminiConfigured()) return { ok: false, reason: "no_key" };
  const sb = supabaseServer();

  const { data: g } = await sb.from("image_generations").select("*").eq("id", input.generationId).maybeSingle();
  const gen = g as any;
  if (!gen || !gen.output_path) return { ok: false, reason: "not_found" };

  // Build the image stack fed to the editor, in priority order:
  //   1. the marked copy (WHERE to edit) — if the owner drew a box,
  //   2. the clean generated candidate (the image being edited),
  //   3. the ORIGINAL raw reference (the true design — the fidelity anchor).
  const images: { base64: string; mime?: string }[] = [];
  const hasMarker = !!input.markedBase64;
  if (hasMarker) images.push({ base64: input.markedBase64!, mime: input.markedMime ?? "image/png" });
  const outImg = await fetchAsBase64(gen.output_path);
  if (outImg) images.push({ base64: outImg.base64, mime: outImg.mime });

  // The fix must reproduce the UPLOADED photo's true details. Use this generation's own reference,
  // and if it doesn't carry one (older rows), fall back to the product's current raw upload
  // (kind 'source'/'flatlay') — the exact photo the owner uploaded — so the correction is always
  // anchored to the real piece, never guessed from the generated image alone.
  let hasReference = false;
  let refUrl: string | null = gen.raw_image_path ?? null;
  if (!refUrl) {
    const { data: imgs } = await sb.from("product_images").select("path,kind").eq("product_id", gen.product_id);
    const all = ((imgs as any[]) ?? []).filter((i) => typeof i.path === "string" && i.path.startsWith("http"));
    refUrl = (all.find((i) => i.kind === "source" || i.kind === "flatlay") ?? all.find((i) => i.kind === "source"))?.path ?? null;
  }
  if (refUrl) {
    const ref = await fetchAsBase64(refUrl);
    if (ref) { images.push({ base64: ref.base64, mime: ref.mime }); hasReference = true; }
  }
  if (!images.length) return { ok: false, reason: "no_source" };

  const meta = SHOT_META[gen.shot_type as ShotType] ?? SHOT_META.hero;
  const { data: prod } = await sb.from("products").select("sku,name, category:categories(name)").eq("id", gen.product_id).maybeSingle();
  const prow = prod as any;
  const prompt = buildRefinePrompt({
    instruction, hasReference, hasMarker,
    productName: prow?.name, typeLabel: prow?.category?.name,
  });

  const result = await editImage({ prompt, images, aspectRatio: meta.aspect });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const ext = result.mime.includes("png") ? "png" : "jpg";
  const path = `${prow?.sku ?? gen.product_id}/${gen.shot_type}-fix-${Date.now()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(result.base64, "base64"), { contentType: result.mime, upsert: true });
  if (up.error) return { ok: false, reason: "upload_failed", error: up.error.message };
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);

  const { count } = await sb.from("image_generations").select("id", { count: "exact", head: true }).eq("product_id", gen.product_id).eq("shot_type", gen.shot_type);
  const { data: row } = await sb.from("image_generations").insert({
    product_id: gen.product_id, variant_id: gen.variant_id ?? null, raw_image_path: gen.raw_image_path,
    output_path: pub.publicUrl, shot_type: gen.shot_type, prompt, settings: gen.settings ?? {}, detected: gen.detected ?? null,
    provider: result.model, version: (count ?? 0) + 1, status: "candidate", created_by: "owner",
    parent_id: gen.id, edit_instruction: instruction, edit_region: input.region ?? null,
  }).select("id").maybeSingle();

  await logActivity({ action: "photo_refined", ref: prow?.sku ?? gen.product_id, detail: `${gen.shot_type} fix (${result.model})` });
  revalidatePath(`/admin/media/${gen.product_id}`);
  return { ok: true, id: (row as any)?.id, url: pub.publicUrl, provider: result.model };
}

/** A/B status: favorite | rejected | archived | candidate (restore). */
export async function setGenerationStatusAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.ai"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const status = String(formData.get("status") ?? "");
  if (!id || !["candidate", "favorite", "rejected", "archived"].includes(status)) return;
  const sb = supabaseServer();
  const { data: g } = await sb.from("image_generations").update({ status }).eq("id", id).select("product_id").maybeSingle();
  await logActivity({ action: "photo_status", ref: id, detail: status });
  if ((g as any)?.product_id) revalidatePath(`/admin/media/${(g as any).product_id}`);
}

/** Publish a candidate → storefront. Copies its URL into product_images and sets it as the
 *  primary hero (or an angle), so every storefront surface updates. Previous images are kept. */
export async function publishGenerationAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.publish")) && !(await requirePerm("catalog.ai"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  const { data: g } = await sb.from("image_generations").select("*").eq("id", id).maybeSingle();
  const gen = g as any;
  if (!gen || !gen.output_path) return;

  const isHero = ["hero", "model", "lifestyle", "social_crop"].includes(gen.shot_type);
  const kind = isHero ? "model" : "angle";

  if (isHero) {
    // Demote the current primary, then insert this as the new primary (sort -10). Non-destructive.
    await sb.from("product_images").update({ sort: 2 }).eq("product_id", gen.product_id).lt("sort", 0);
  }
  await sb.from("product_images").insert({
    product_id: gen.product_id, variant_id: gen.variant_id ?? null, path: gen.output_path,
    kind, sort: isHero ? -10 : 1, generation_id: gen.id, metadata: { shot_type: gen.shot_type, provider: gen.provider },
  });
  await sb.from("image_generations").update({ status: "published" }).eq("id", id);

  // Update every storefront surface.
  const { data: prod } = await sb.from("products").select("sku, category:categories(slug)").eq("id", gen.product_id).maybeSingle();
  const sku = (prod as any)?.sku;
  const slug = (prod as any)?.category?.slug ?? "all";
  await logActivity({ action: "photo_published", ref: sku ?? gen.product_id, detail: gen.shot_type });
  revalidatePath(`/admin/media/${gen.product_id}`);
  revalidatePath("/admin/catalogue"); revalidatePath("/admin/products"); revalidatePath("/shop");
  if (sku) { revalidatePath(`/shop/${slug}/${sku}`); revalidatePath(`/admin/products/${gen.product_id}`); }
}

/** Store a client-composited BRANDED image (the "blythediva" wordmark was drawn onto the
 *  AI stand shot in the browser) and publish it — attached to the variant if given. */
export async function uploadBrandedImageAction(input: {
  productId: string; variantId?: string | null; base64: string; mime?: string; shotType?: string;
}): Promise<GenOut> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, reason: "not_permitted" };
  const { productId } = input;
  if (!productId || !input.base64) return { ok: false, reason: "bad_input" };
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,sku, category:categories(slug)").eq("id", productId).maybeSingle();
  if (!p) return { ok: false, reason: "not_found" };
  const prod = p as any;
  const mime = input.mime ?? "image/png";
  const ext = mime.includes("png") ? "png" : "jpg";
  const shot = input.shotType || "branded_stand";

  await sb.storage.createBucket(BUCKET, { public: true }).catch(() => {});
  const path = `${prod.sku}/${shot}-branded-${Date.now()}.${ext}`;
  const up = await sb.storage.from(BUCKET).upload(path, Buffer.from(input.base64, "base64"), { contentType: mime, upsert: true });
  if (up.error) return { ok: false, reason: "upload_failed", error: up.error.message };
  const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  const { count } = await sb.from("image_generations").select("id", { count: "exact", head: true }).eq("product_id", productId).eq("shot_type", shot);
  const { data: row } = await sb.from("image_generations").insert({
    product_id: productId, variant_id: input.variantId ?? null, output_path: url, shot_type: shot,
    settings: { branded: true }, provider: "overlay", version: (count ?? 0) + 1, status: "published", created_by: "owner",
  }).select("id").maybeSingle();

  // Publish to the storefront: product image + (if a variant) append to that variant's gallery.
  await sb.from("product_images").insert({ product_id: productId, variant_id: input.variantId ?? null, path: url, kind: "angle", generation_id: (row as any)?.id ?? null, sort: 1, metadata: { shot_type: shot, branded: true } });
  if (input.variantId) {
    const { data: v } = await sb.from("variants").select("image_paths").eq("id", input.variantId).maybeSingle();
    const paths = Array.isArray((v as any)?.image_paths) ? (v as any).image_paths : [];
    await sb.from("variants").update({ image_paths: [url, ...paths] }).eq("id", input.variantId);
  }

  await logActivity({ action: "photo_published", ref: prod.sku, detail: `${shot} (branded)` });
  revalidatePath(`/admin/media/${productId}`); revalidatePath("/shop"); revalidatePath("/admin/catalogue");
  if (prod.sku) revalidatePath(`/shop/${prod.category?.slug ?? "all"}/${prod.sku}`);
  return { ok: true, id: (row as any)?.id, url };
}

/** Auto-detect + persist the piece classification (the studio's "AI inspect" step). */
export async function detectJewelleryAction(productId: string): Promise<{ ok: boolean; detected?: any }> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false };
  const sb = supabaseServer();
  // No subcategory embed here — products→subcategories is ambiguous for PostgREST (direct FK AND
  // product_subcategory_map), which would error the whole query. Look it up separately & guarded.
  const { data: p } = await sb.from("products").select("id,name,subcategory_id, category:categories(name), images:product_images(path,kind)").eq("id", productId).maybeSingle();
  if (!p) return { ok: false };
  const prod = p as any;
  let subName: string | null = null;
  if (prod.subcategory_id) {
    try { const { data: sc } = await sb.from("subcategories").select("name").eq("id", prod.subcategory_id).maybeSingle(); subName = (sc as any)?.name ?? null; } catch { /* category framing still applies */ }
  }
  const ref = (prod.images ?? []).find((i: any) => typeof i.path === "string" && i.path.startsWith("http"));
  const detected = await detectJewellery({
    imageUrl: ref?.path,
    hint: [prod.name, prod.category?.name, subName].filter(Boolean).join(" "),
    knownCategory: subName || prod.category?.name,
  });
  revalidatePath(`/admin/media/${productId}`);
  return { ok: true, detected };
}
