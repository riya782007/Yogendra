/**
 * lib/ai/openaiImage.ts — OpenAI image generation/edit (gpt-image-1.5), server-only.
 *
 * Used as an automatic FALLBACK when the Gemini image chain fails (e.g. billing/429).
 * For our raw→model-shot pipeline we use the /images/edits endpoint with the owner's
 * raw product photo as the input image, plus `input_fidelity: high` so the model
 * preserves the exact design of the jewellery — critical for a manufacturer.
 *
 * If there's no reference image we fall back to /images/generations.
 * Returns the same GenImageResult shape as the Gemini provider.
 */
import "server-only";

export type OpenAIImageResult =
  | { ok: true; base64: string; mime: string; model: string }
  | { ok: false; reason: "no_key" | "api_error" | "no_image"; error?: string };

const MODEL = () => process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1.5";
function openaiKey(): string | undefined {
  return process.env.OPENAI_API_KEY ?? process.env.openai_api_key ?? process.env.OpenAI_api_key;
}

/** gpt-image only supports 1024x1024, 1024x1536 (portrait), 1536x1024 (landscape), auto. */
function sizeFor(aspect?: string): string {
  if (aspect === "1:1") return "1024x1024";
  return "1024x1536"; // portrait — closest to a 4:5 product-page hero
}

export async function generateImageOpenAI(opts: {
  prompt: string;
  referenceBase64?: string;
  referenceMime?: string;
  aspectRatio?: string;
  timeoutMs?: number;
}): Promise<OpenAIImageResult> {
  const key = openaiKey();
  if (!key) return { ok: false, reason: "no_key" };

  const model = MODEL();
  const size = sizeFor(opts.aspectRatio);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);

  try {
    let res: Response;
    if (opts.referenceBase64) {
      // EDIT: transform the real raw photo into an editorial model shot, preserving the design.
      const mime = opts.referenceMime ?? "image/png";
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      const bytes = Buffer.from(opts.referenceBase64, "base64");
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", opts.prompt);
      form.append("size", size);
      form.append("quality", "high");
      form.append("input_fidelity", "high"); // keep the jewellery design exact
      form.append("image[]", new Blob([bytes], { type: mime }), `reference.${ext}`);
      res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal: controller.signal,
      });
    } else {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: opts.prompt, size, quality: "high", n: 1 }),
        signal: controller.signal,
      });
    }

    if (!res.ok) {
      const txt = (await res.text()).slice(0, 400);
      const err = `[openai:${model}] HTTP ${res.status}: ${txt}`;
      console.error("[openai-image]", err);
      return { ok: false, reason: "api_error", error: err };
    }
    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, reason: "no_image", error: `[openai:${model}] no b64_json in response` };
    return { ok: true, base64: b64, mime: "image/png", model: `openai:${model}` };
  } catch (e) {
    const err = `[openai] ${e instanceof Error ? e.message : String(e)}`;
    console.error("[openai-image]", err);
    return { ok: false, reason: "api_error", error: err };
  } finally {
    clearTimeout(t);
  }
}

/**
 * editImageOpenAI — surgical, instruction-driven edit of an existing image (the OpenAI fallback
 * for the "Fix a detail" flow). Sends MULTIPLE images to /images/edits: image 0 is the one being
 * edited (usually the generated shot, or a marked copy), and any further images are references
 * (the original raw product photo) so the true design is preserved. `input_fidelity: high` keeps
 * the rest of the image intact.
 */
export async function editImageOpenAI(opts: {
  prompt: string;
  images: { base64: string; mime?: string }[];
  aspectRatio?: string;
  timeoutMs?: number;
}): Promise<OpenAIImageResult> {
  const key = openaiKey();
  if (!key) return { ok: false, reason: "no_key" };
  if (!opts.images.length) return { ok: false, reason: "no_image", error: "no input image" };

  const model = MODEL();
  const size = sizeFor(opts.aspectRatio);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
  try {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", opts.prompt);
    form.append("size", size);
    form.append("quality", "high");
    form.append("input_fidelity", "high");
    opts.images.forEach((im, i) => {
      const mime = im.mime ?? "image/png";
      const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
      form.append("image[]", new Blob([Buffer.from(im.base64, "base64")], { type: mime }), `img${i}.${ext}`);
    });
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = (await res.text()).slice(0, 400);
      const err = `[openai:${model}] HTTP ${res.status}: ${txt}`;
      console.error("[openai-image] edit", err);
      return { ok: false, reason: "api_error", error: err };
    }
    const json: any = await res.json();
    const b64 = json?.data?.[0]?.b64_json;
    if (!b64) return { ok: false, reason: "no_image", error: `[openai:${model}] no b64_json in response` };
    return { ok: true, base64: b64, mime: "image/png", model: `openai:${model}` };
  } catch (e) {
    const err = `[openai] ${e instanceof Error ? e.message : String(e)}`;
    console.error("[openai-image] edit", err);
    return { ok: false, reason: "api_error", error: err };
  } finally {
    clearTimeout(t);
  }
}
