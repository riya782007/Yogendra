/**
 * NVIDIA-hosted FLUX.1 Kontext [dev] — jewellery-grade image generation & editing.
 *
 * Kontext takes a REFERENCE image + a text instruction and restyles the scene while preserving the
 * actual product (exact stones, setting, shape) — which is exactly what an artificial-jewellery store
 * needs (a clean model shot / branded stand shot that doesn't redraw the piece).
 *
 * Everything here is BEST-EFFORT and self-contained: any failure returns { ok:false } so the caller
 * falls back to the Gemini→OpenAI chain. FLUX is therefore a pure upgrade — it can only make images
 * better/cheaper, never break generation.
 *
 * Env:
 *   NVIDIA_API_KEY      (required to enable)     — from build.nvidia.com
 *   NVIDIA_IMAGE_MODEL  default black-forest-labs/flux.1-kontext-dev
 *   NVIDIA_IMAGE_URL    optional full invoke URL override
 *   NVIDIA_IMAGE_STEPS  default 30   (quality vs credits — lower = cheaper/faster)
 *   NVIDIA_IMAGE_CFG    default 3.5  (how strictly it follows the prompt)
 */

export type FluxResult =
  | { ok: true; base64: string; mime: string; model: string }
  | { ok: false; reason: string; error?: string };

export function nvidiaConfigured(): boolean {
  return !!process.env.NVIDIA_API_KEY;
}

const MODEL = () => process.env.NVIDIA_IMAGE_MODEL || "black-forest-labs/flux.1-kontext-dev";
const INVOKE_URL = () => process.env.NVIDIA_IMAGE_URL || `https://ai.api.nvidia.com/v1/genai/${MODEL()}`;
const STEPS = () => Math.max(10, Math.min(50, Number(process.env.NVIDIA_IMAGE_STEPS) || 30));
const CFG = () => { const n = Number(process.env.NVIDIA_IMAGE_CFG); return Number.isFinite(n) && n > 0 ? n : 3.5; };

/** Upload a reference image to the NVCF asset store; returns its asset id (or null). */
async function uploadAsset(key: string, base64: string, mime: string, signal: AbortSignal): Promise<string | null> {
  try {
    const auth = await fetch("https://api.nvcf.nvidia.com/v2/nvcf/assets", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ contentType: mime, description: "blythediva-reference" }),
      signal,
    });
    if (!auth.ok) return null;
    const j: any = await auth.json();
    const assetId: string | undefined = j?.assetId;
    const uploadUrl: string | undefined = j?.uploadUrl;
    if (!assetId || !uploadUrl) return null;
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mime, "x-amz-meta-nvcf-asset-description": "blythediva-reference" },
      body: Buffer.from(base64, "base64"),
      signal,
    });
    if (!put.ok) return null;
    return assetId;
  } catch { return null; }
}

/** Pull the output image (base64) out of whatever shape NVIDIA returns. */
async function extractImage(res: Response, signal: AbortSignal): Promise<{ base64: string; mime: string } | null> {
  // Large outputs may come back as a downloadable asset instead of inline JSON.
  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), mime: ct };
  }
  let j: any;
  try { j = await res.json(); } catch { return null; }
  const strip = (s: string) => (s.includes(",") && s.trim().startsWith("data:") ? s.slice(s.indexOf(",") + 1) : s);
  const cand =
    j?.artifacts?.[0]?.base64 ?? j?.image ?? j?.images?.[0]?.base64 ?? j?.images?.[0] ??
    j?.data?.[0]?.b64_json ?? j?.b64_json ?? null;
  if (typeof cand === "string" && cand.length > 100) return { base64: strip(cand), mime: "image/png" };
  // Asset-referenced output → fetch the URL.
  const url = j?.artifacts?.[0]?.url ?? j?.image_url ?? j?.url ?? null;
  if (typeof url === "string" && url.startsWith("http")) {
    try {
      const img = await fetch(url, { signal });
      if (img.ok) { const buf = Buffer.from(await img.arrayBuffer()); return { base64: buf.toString("base64"), mime: img.headers.get("content-type") || "image/png" }; }
    } catch { /* fall through */ }
  }
  return null;
}

/**
 * Generate (or edit) with FLUX Kontext. If `referenceBase64` is given it runs image-to-image
 * (preserve the product, restyle the scene); otherwise text-to-image.
 */
export async function fluxKontext(opts: {
  prompt: string;
  referenceBase64?: string;
  referenceMime?: string;
  timeoutMs?: number;
}): Promise<FluxResult> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) return { ok: false, reason: "no_key" };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const body: any = { prompt: opts.prompt, cfg_scale: CFG(), steps: STEPS(), seed: 0 };
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json",
    };

    if (opts.referenceBase64) {
      const mime = opts.referenceMime || "image/jpeg";
      // Inline the reference when reasonably sized (covers compressed product photos); only very large
      // inputs use the NVCF asset upload. Keeping refs inline avoids the multi-step asset flow.
      const bytes = Math.ceil((opts.referenceBase64.length * 3) / 4);
      if (bytes <= 700_000) {
        body.image = `data:${mime};base64,${opts.referenceBase64}`;
      } else {
        const assetId = await uploadAsset(key, opts.referenceBase64, mime, controller.signal);
        if (!assetId) return { ok: false, reason: "asset_upload_failed" };
        body.image = `data:${mime};asset_id,${assetId}`;
        headers["NVCF-INPUT-ASSET-REFERENCES"] = assetId;
      }
      // NOTE: FLUX Kontext infers image-to-image from the presence of `image`; it REJECTS a `mode`
      // field ("extra_forbidden"), so we must not send one.
    }

    const res = await fetch(INVOKE_URL(), { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const txt = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, reason: `http_${res.status}`, error: `[flux] ${res.status}: ${txt}` };
    }
    const img = await extractImage(res, controller.signal);
    if (!img) return { ok: false, reason: "no_image" };
    return { ok: true, base64: img.base64, mime: img.mime, model: `nvidia/${MODEL()}` };
  } catch (e) {
    return { ok: false, reason: "threw", error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}
