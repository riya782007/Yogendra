"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { generateImage, geminiConfigured } from "@/lib/ai/gemini";
import { buildVariantImagePrompt } from "@/lib/ai/imagePrompt";
import { getColorCodeMap } from "@/lib/supabase/queries";
import { barcodeCodeForColor } from "@/lib/colors";

const BUCKET = "product-media";

/** Ensure the variants/product-images bucket exists AND is public.
 *
 *  Why this is a function (not just `createBucket(... public:true)`): a previous run may have
 *  created the bucket with `public: false`, and `createBucket` errors on existing buckets
 *  (which we swallow). Without `updateBucket`, every subsequent upload would land in a
 *  bucket where `getPublicUrl(...)` returns a URL that 404s for end users — exactly the
 *  "image uploaded but won't load" symptom reported (Pillar 16).
 *  This helper is idempotent and cheap; we call it everywhere we put bytes in. */
async function ensureMediaBucket(sb: ReturnType<typeof supabaseServer>) {
  const created = await sb.storage.createBucket(BUCKET, { public: true }).catch(() => null);
  if (created === null || (created && (created as any).error)) {
    // Already existed — make sure it's public.
    await sb.storage.updateBucket(BUCKET, { public: true }).catch(() => {});
  }
}

/** Build a readable variant SKU suffix from whichever attributes are present, preferring
 *  the canonical colour code from the colours master (Pillar 11). Examples:
 *    autoSku("BD2024", { color: "Red" })              → "BD2024-RED"
 *    autoSku("BD2024", { color: "Red", size: "M" })   → "BD2024-RED-M"
 *    autoSku("BD2024", { size: "M", polish: "Matte"}) → "BD2024-M-MATT"
 *  If `colorCode` is supplied (a DB-resolved override from `variant_options.barcode_code`)
 *  it wins over the static fallback in `lib/colors.ts`. */
function autoSku(
  productSku: string,
  parts: { color?: string | null; size?: string | null; polish?: string | null },
  colorCodeOverride?: string | null,
): string {
  const colorCode = colorCodeOverride ?? (parts.color ? barcodeCodeForColor(parts.color) : null);
  const sizeCode = parts.size ? parts.size.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
  const polishCode = parts.polish ? parts.polish.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
  const suffix = [colorCode, sizeCode, polishCode].filter(Boolean).join("-") || "VAR";
  return `${productSku}-${suffix}`;
}

/** Parse a rupee form field to integer paise, or null when blank (= "use the formula price"). */
function toPaise(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/** Remember any new colour/size/polish value so the master list grows itself. */
async function rememberOptions(sb: ReturnType<typeof supabaseServer>, o: { color?: string; size?: string; polish?: string }) {
  const rows: { kind: string; value: string }[] = [];
  if (o.color) rows.push({ kind: "color", value: o.color });
  if (o.size) rows.push({ kind: "size", value: o.size });
  if (o.polish) rows.push({ kind: "polish", value: o.polish });
  if (rows.length) await sb.from("variant_options").upsert(rows, { onConflict: "kind,value", ignoreDuplicates: true });
}

function reval(productSku: string) {
  revalidatePath(`/admin/catalogue/${productSku}`);
  revalidatePath(`/admin/product/${productSku}`);
  revalidatePath("/shop");
}

export async function addVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const productSku = String(formData.get("product_sku") ?? "").trim();
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const polish = String(formData.get("polish") ?? "").trim();
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  let vsku = String(formData.get("sku") ?? "").trim().toUpperCase();
  // At least one attribute is required so the variant is meaningful.
  if (!productSku || !(color || size || polish)) return;
  const sb = supabaseServer();
  const [{ data: p }, codes] = await Promise.all([
    sb.from("products").select("id,type").ilike("sku", productSku).maybeSingle(),
    color ? getColorCodeMap() : Promise.resolve({} as Record<string, string>),
  ]);
  if (!p) return;
  const dbColorCode = color ? codes[color.toLowerCase()] ?? null : null;
  if (!vsku) vsku = autoSku(productSku, { color, size, polish }, dbColorCode);
  await sb.from("variants").insert({
    product_id: (p as any).id, color: color || null, size: size || null, polish: polish || null, sku: vsku, qty,
    retail_override: toPaise(formData.get("retail")), wholesale_override: toPaise(formData.get("wholesale")), mrp_override: toPaise(formData.get("mrp")),
  });
  await rememberOptions(sb, { color, size, polish });
  if ((p as any).type !== "configurable") await sb.from("products").update({ type: "configurable" }).eq("id", (p as any).id);
  reval(productSku);
}

export async function updateVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  const color = String(formData.get("color") ?? "").trim();
  const size = String(formData.get("size") ?? "").trim();
  const polish = String(formData.get("polish") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  if (!id || !(color || size || polish)) return;
  const sb = supabaseServer();
  const codes = color ? await getColorCodeMap() : ({} as Record<string, string>);
  const dbColorCode = color ? codes[color.toLowerCase()] ?? null : null;
  await sb.from("variants").update({
    color: color || null, size: size || null, polish: polish || null,
    sku: sku || autoSku(productSku, { color, size, polish }, dbColorCode), qty,
    retail_override: toPaise(formData.get("retail")), wholesale_override: toPaise(formData.get("wholesale")), mrp_override: toPaise(formData.get("mrp")),
  }).eq("id", id);
  await rememberOptions(sb, { color, size, polish });
  reval(productSku);
}

export async function deleteVariantAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  await supabaseServer().from("variants").delete().eq("id", id);
  reval(productSku);
}

/** Upload one or more photos for a single variant (so blue shows the blue piece, etc.).
 *  Returns a result so the client uploader can show success/error feedback (Pillar 16). */
export async function addVariantImageAction(formData: FormData): Promise<{ ok: boolean; urls?: string[]; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "Your role can't edit the catalogue." };
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  if (!id) return { ok: false, error: "Missing variant." };
  const sb = supabaseServer();
  const files = formData.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "No image selected." };
  await ensureMediaBucket(sb);
  const { data: v } = await sb.from("variants").select("image_paths").eq("id", id).maybeSingle();
  if (!v) return { ok: false, error: "Variant not found." };
  const paths: string[] = [...(((v as any)?.image_paths as string[]) ?? [])];
  const added: string[] = [];
  for (const file of files) {
    const ext = ((file.type.split("/")[1]) || "jpg").replace("jpeg", "jpg");
    const path = `variants/${id}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const up = await sb.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "image/jpeg", upsert: true });
    if (up.error) return { ok: false, error: up.error.message };
    const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    paths.push(url); added.push(url);
  }
  await sb.from("variants").update({ image_paths: paths }).eq("id", id);
  reval(productSku);
  return { ok: true, urls: added };
}

export async function deleteVariantImageAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const id = String(formData.get("id") ?? "");
  const productSku = String(formData.get("product_sku") ?? "");
  const url = String(formData.get("url") ?? "");
  if (!id || !url) return;
  const sb = supabaseServer();
  const { data: v } = await sb.from("variants").select("image_paths").eq("id", id).maybeSingle();
  const paths = (((v as any)?.image_paths as string[]) ?? []).filter((u) => u !== url);
  await sb.from("variants").update({ image_paths: paths }).eq("id", id);
  reval(productSku);
}

export type VariantImgResult = { ok: boolean; reason?: string; error?: string; url?: string };

/**
 * Module 3 — generate a professional per-variant product photo via Gemini
 * (OpenAI fallback). Uses the parent product's best existing photo as the design reference
 * and re-renders it with the variant's attributes (colour and/or size/polish), so customers
 * can view each variation individually. The new image is appended to the variant's
 * image_paths and shows everywhere the variant does (product page swatch gallery, wholesale,
 * inventory). Invoked only by an explicit button.
 */
export async function generateVariantImageAction(variantId: string): Promise<VariantImgResult> {
  if (!(await requirePerm("catalog.ai"))) return { ok: false, reason: "not_permitted" };
  if (!variantId) return { ok: false, reason: "not_found" };
  const sb = supabaseServer();

  const { data: v } = await sb
    .from("variants")
    .select("id, color, size, polish, sku, image_paths, product_id")
    .eq("id", variantId)
    .maybeSingle();
  if (!v) return { ok: false, reason: "not_found" };
  const color = String((v as any).color ?? "").trim();
  const size = String((v as any).size ?? "").trim();
  const polish = String((v as any).polish ?? "").trim();
  // Pillar 16: allow AI photos for any variant that has at least one distinguishing
  // attribute — colour OR size OR polish. The previous version required `color`, which left
  // size/polish-only variants without a way to get an AI image.
  if (!color && !size && !polish) return { ok: false, reason: "no_attribute" };

  const { data: prod } = await sb
    .from("products")
    .select("id, sku, categories(slug)")
    .eq("id", (v as any).product_id)
    .maybeSingle();
  const productSku = String((prod as any)?.sku ?? "");
  const categorySlug = String((prod as any)?.categories?.slug ?? "necklace");

  if (!geminiConfigured()) return { ok: false, reason: "no_key" };

  // Pick the design reference: parent product's best photo (model > any http), else the
  // variant's own first photo.
  const { data: pimgs } = await sb
    .from("product_images")
    .select("path, kind, sort")
    .eq("product_id", (v as any).product_id)
    .order("sort", { ascending: true });
  const productImgs = ((pimgs as any[]) ?? []).filter((i) => String(i.path).startsWith("http"));
  const refUrl =
    productImgs.find((i) => i.kind === "model")?.path ??
    productImgs[0]?.path ??
    (((v as any).image_paths as string[]) ?? []).find((u) => u.startsWith("http"));
  if (!refUrl) return { ok: false, reason: "no_source" };

  let referenceBase64: string, referenceMime = "image/jpeg";
  try {
    const r = await fetch(refUrl);
    referenceMime = r.headers.get("content-type") || "image/jpeg";
    referenceBase64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  } catch {
    return { ok: false, reason: "no_source" };
  }

  const prompt = buildVariantImagePrompt({ category: categorySlug, color: color || size || polish, aspect: "1:1" });
  const result = await generateImage({ prompt, referenceBase64, referenceMime, aspectRatio: "1:1" });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  await ensureMediaBucket(sb);
  const ext = result.mime.includes("png") ? "png" : "jpg";
  const path = `variants/${variantId}/ai-${Date.now()}.${ext}`;
  const up = await sb.storage
    .from(BUCKET)
    .upload(path, Buffer.from(result.base64, "base64"), { contentType: result.mime, upsert: true });
  if (up.error) return { ok: false, reason: "upload_failed", error: up.error.message };

  const url = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const next = [...(((v as any).image_paths as string[]) ?? []), url];
  await sb.from("variants").update({ image_paths: next }).eq("id", variantId);

  if (productSku) reval(productSku);
  revalidatePath("/wholesale");
  revalidatePath("/admin/inventory");
  return { ok: true, url };
}
