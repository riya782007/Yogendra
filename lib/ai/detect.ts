/**
 * lib/ai/detect.ts — inspect a raw jewellery photo and auto-classify it, server-only.
 * Uses Gemini vision (the existing GEMINI_API_KEY) to read the image; falls back to keyword
 * detection from the product name/category when no key or the call fails. Drives the studio's
 * "choose the best generation strategy" step.
 */
import "server-only";

export type Detected = { category: string; material: string; style: string; attributes: string[] };

const CATS = ["necklace", "bracelet", "ring", "maang tikka", "earrings", "pendant", "anklet", "bangle", "nath", "kamarband"];
const MATERIALS = ["kundan", "polki", "temple", "oxidised", "american diamond", "pearl", "silver", "gold", "meenakari"];
const STYLES = ["bridal", "partywear", "minimal", "heavy", "statement", "traditional", "modern"];

function keywordDetect(text: string): Detected {
  const t = (text || "").toLowerCase();
  const pick = (list: string[], fb: string) => list.find((k) => t.includes(k)) ?? fb;
  return {
    category: pick(CATS, "necklace"),
    material: pick(MATERIALS, "kundan"),
    style: pick(STYLES, "traditional"),
    attributes: [...MATERIALS, ...STYLES].filter((k) => t.includes(k)).slice(0, 6),
  };
}

function geminiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.gemini_api_key ?? process.env.Gemini_api_key;
}

/** Normalise an owner-set category/subcategory name to a known CATS keyword when possible, so the
 *  detected label agrees with the catalogue (a "Kundan Necklace" subcategory → "necklace"). */
function normaliseKnown(known?: string): string | null {
  const t = (known ?? "").toLowerCase().trim();
  if (!t) return null;
  return CATS.find((c) => t.includes(c)) ?? null;
}

export async function detectJewellery(opts: { imageUrl?: string; hint?: string; knownCategory?: string; timeoutMs?: number }): Promise<Detected> {
  const fallback = keywordDetect(opts.hint ?? "");
  // The owner's catalogue is the source of truth for the piece's TYPE. When we know it, lock the
  // detected category to it — the vision model only refines material/style/attributes. This stops a
  // vision mis-read (necklace seen as "bracelet") from ever mislabelling or misframing the piece.
  const known = normaliseKnown(opts.knownCategory) ?? normaliseKnown(opts.hint);
  if (known) fallback.category = known;
  const key = geminiKey();
  if (!key || !opts.imageUrl) return fallback;

  let base64: string, mime = "image/jpeg";
  try {
    const r = await fetch(opts.imageUrl);
    mime = r.headers.get("content-type") || "image/jpeg";
    base64 = Buffer.from(await r.arrayBuffer()).toString("base64");
  } catch {
    return fallback;
  }

  const model = process.env.GEMINI_TEXT_MODEL ?? "gemini-2.5-flash";
  const sys = `You are a jewellery merchandiser. Inspect the image and classify the piece. Respond with STRICT JSON only:
{"category": one of [${CATS.join(", ")}], "material": one of [${MATERIALS.join(", ")}], "style": one of [${STYLES.join(", ")}], "attributes": up to 6 short tags}.`;
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 18_000);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ inline_data: { mime_type: mime, data: base64 } }, { text: sys }] }],
        generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
      }),
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const j: any = await res.json();
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    const parsed = JSON.parse(text);
    return {
      // Known catalogue type wins over the vision guess for the category (see above); vision still
      // supplies the richer material / style / attribute detail.
      category: known ?? String(parsed.category ?? fallback.category),
      material: String(parsed.material ?? fallback.material),
      style: String(parsed.style ?? fallback.style),
      attributes: Array.isArray(parsed.attributes) ? parsed.attributes.map(String).slice(0, 6) : fallback.attributes,
    };
  } catch {
    return fallback;
  } finally {
    clearTimeout(t);
  }
}
