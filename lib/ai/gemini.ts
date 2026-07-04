/**
 * lib/ai/gemini.ts — Gemini image generation (Nano Banana Pro / 2 / 1).
 *
 * IMPORTANT: the request body differs by model family.
 *   - Gemini 3 image models (gemini-3-pro-image, gemini-3.1-flash-image) accept
 *       generationConfig.responseModalities = ["TEXT","IMAGE"] and imageConfig.aspectRatio.
 *   - Gemini 2.5 image model (gemini-2.5-flash-image) does NOT accept those fields
 *       (returns 400 "Unknown name responseModalities / imageConfig"). It returns an
 *       image by default, so we send the bare contents with no generationConfig.
 *
 * We use the v1beta endpoint (superset; serves all image models). We try the configured
 * primary model first, then fall back down the chain — so generation still succeeds even
 * if the key's tier can't access the newer Gemini 3 image models (they fall through to 2.5).
 *
 * If the entire Gemini chain fails (e.g. billing/429), we automatically fall back to
 * OpenAI gpt-image-1.5 (see lib/ai/openaiImage.ts) so generation still succeeds.
 *
 * NEVER called on a render path — only from an explicit "Generate" action.
 * Until GEMINI_API_KEY is set: we go straight to the OpenAI fallback if its key exists.
 */
import { generateImageOpenAI, editImageOpenAI } from "./openaiImage";

const PRIMARY = () => process.env.GEMINI_IMAGE_MODEL ?? "gemini-3-pro-image";

/** primary first, then the rest (deduped) — best fidelity first, reliable last. */
function modelChain(): string[] {
  const chain = [PRIMARY(), "gemini-3-pro-image", "gemini-3.1-flash-image", "gemini-2.5-flash-image"];
  return [...new Set(chain)];
}

const ENDPOINT = (m: string) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

/** Gemini 3 image models accept modalities + imageConfig; 2.5 does not. */
function isGen3(model: string): boolean {
  return model.includes("gemini-3");
}

export type GenImageResult =
  | { ok: true; base64: string; mime: string; model: string }
  | { ok: false; reason: "no_key" | "no_source" | "api_error" | "no_image"; error?: string };

function openaiKeyPresent(): boolean {
  return !!(process.env.OPENAI_API_KEY ?? process.env.openai_api_key ?? process.env.OpenAI_api_key);
}

/** True if EITHER provider can generate images (Gemini primary, OpenAI fallback). */
export function geminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY || openaiKeyPresent();
}

/** Run the OpenAI fallback and adapt its result to GenImageResult. */
async function openaiFallback(opts: {
  prompt: string; referenceBase64?: string; referenceMime?: string; aspectRatio?: string; timeoutMs?: number;
}, priorErr: string): Promise<GenImageResult> {
  if (!openaiKeyPresent()) return { ok: false, reason: "api_error", error: priorErr || "no provider available" };
  const r = await generateImageOpenAI(opts);
  if (r.ok) return { ok: true, base64: r.base64, mime: r.mime, model: r.model };
  return { ok: false, reason: r.reason === "no_key" ? "api_error" : r.reason, error: r.error ?? priorErr };
}

/**
 * Run the Gemini image-model chain for a prebuilt `parts` array (input images + a text prompt).
 * Returns the first model that yields an image, or a failure carrying the last error string.
 * Shared by generateImage (raw → shot) and editImage (surgical "fix a detail" edit).
 */
async function runGeminiChain(key: string, parts: any[], aspectRatio?: string, timeoutMs?: number): Promise<GenImageResult & { _lastErr?: string }> {
  const chain = modelChain();
  let lastErr = "";
  for (const model of chain) {
    const payload: any = { contents: [{ role: "user", parts }] };
    if (isGen3(model)) {
      payload.generationConfig = { responseModalities: ["TEXT", "IMAGE"] };
      if (aspectRatio) payload.generationConfig.imageConfig = { aspectRatio };
    }
    // gemini-2.5-flash-image: no generationConfig — it returns an image by default.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs ?? 120_000);
    try {
      const res = await fetch(ENDPOINT(model), {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok) {
        const txt = (await res.text()).slice(0, 400);
        lastErr = `[${model}] HTTP ${res.status}: ${txt}`;
        console.error("[gemini] image api error:", lastErr);
        // 400/403/404 → model unavailable/incompatible on this key; 429 → quota for THIS model. Try next.
        if ([400, 403, 404, 429].includes(res.status)) continue;
        // 5xx → not model-specific; stop and report.
        return { ok: false, reason: "api_error", error: lastErr, _lastErr: lastErr };
      }
      const json: any = await res.json();
      const outParts = json?.candidates?.[0]?.content?.parts ?? [];
      const img = outParts.find((p: any) => p.inline_data?.data || p.inlineData?.data);
      const data = img?.inline_data?.data ?? img?.inlineData?.data;
      const mime = img?.inline_data?.mime_type ?? img?.inlineData?.mimeType ?? "image/png";
      if (!data) { lastErr = `[${model}] no image part in response`; console.error("[gemini]", lastErr); continue; }
      return { ok: true, base64: data, mime, model };
    } catch (e) {
      lastErr = `[${model}] ${e instanceof Error ? e.message : String(e)}`;
      console.error("[gemini] fetch threw:", lastErr);
      continue;
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, reason: "api_error", error: lastErr, _lastErr: lastErr };
}

export async function generateImage(opts: {
  prompt: string;
  referenceBase64?: string;
  referenceMime?: string;
  aspectRatio?: string;
  timeoutMs?: number;
}): Promise<GenImageResult> {
  const key = process.env.GEMINI_API_KEY;
  // No Gemini key → go straight to the OpenAI fallback.
  if (!key) return openaiFallback(opts, "");

  // Image FIRST, then the instruction — keeps the reference design front-and-centre.
  const parts: any[] = [];
  if (opts.referenceBase64) parts.push({ inline_data: { mime_type: opts.referenceMime ?? "image/jpeg", data: opts.referenceBase64 } });
  parts.push({ text: opts.prompt });

  const r = await runGeminiChain(key, parts, opts.aspectRatio, opts.timeoutMs);
  if (r.ok) return { ok: true, base64: r.base64, mime: r.mime, model: r.model };

  // Whole Gemini chain failed (billing/429, unavailable models, etc.) → OpenAI fallback.
  console.error("[gemini] all models failed, falling back to OpenAI:", r._lastErr);
  return openaiFallback(opts, r._lastErr ?? "");
}

/**
 * editImage — a SURGICAL, instruction-driven edit of an existing image (the "Fix a detail" flow).
 *
 * `images` are sent to the model in priority order: index 0 is the image being edited (typically a
 * copy of the generated shot with the owner's marked region drawn on it), then the clean generated
 * shot, then the ORIGINAL raw product photo as the ground-truth reference for the corrected detail.
 * Because the edit is local and re-anchored to the real reference, it CONVERGES on the true design
 * instead of re-rolling the whole image the way a fresh generation does.
 *
 * Gemini image models do multi-image conversational edits natively; if the whole Gemini chain is
 * unavailable we fall back to OpenAI /images/edits (input_fidelity: high) with the same images.
 */
export async function editImage(opts: {
  prompt: string;
  images: { base64: string; mime?: string }[];
  aspectRatio?: string;
  timeoutMs?: number;
}): Promise<GenImageResult> {
  if (!opts.images.length) return { ok: false, reason: "no_source" };
  const key = process.env.GEMINI_API_KEY;
  const openaiEdit = async (priorErr: string): Promise<GenImageResult> => {
    if (!openaiKeyPresent()) return { ok: false, reason: "api_error", error: priorErr || "no provider available" };
    const r = await editImageOpenAI({ prompt: opts.prompt, images: opts.images, aspectRatio: opts.aspectRatio, timeoutMs: opts.timeoutMs });
    return r.ok ? { ok: true, base64: r.base64, mime: r.mime, model: r.model } : { ok: false, reason: r.reason === "no_key" ? "api_error" : r.reason, error: r.error ?? priorErr };
  };
  // No Gemini key → OpenAI edit fallback.
  if (!key) return openaiEdit("");

  // Images FIRST (in priority order), then the instruction.
  const parts: any[] = [];
  for (const im of opts.images) parts.push({ inline_data: { mime_type: im.mime ?? "image/jpeg", data: im.base64 } });
  parts.push({ text: opts.prompt });

  const r = await runGeminiChain(key, parts, opts.aspectRatio, opts.timeoutMs);
  if (r.ok) return { ok: true, base64: r.base64, mime: r.mime, model: r.model };
  console.error("[gemini] edit chain failed, falling back to OpenAI:", r._lastErr);
  return openaiEdit(r._lastErr ?? "");
}
