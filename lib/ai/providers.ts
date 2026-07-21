/**
 * lib/ai/providers.ts — OpenAI-compatible chat providers (server-only).
 * Groq and OpenAI both speak the /chat/completions schema. Keys are read with
 * case fallbacks so they work whether set as GROQ_API_KEY or Groq_api_key, etc.
 */
import "server-only";

function env(...names: string[]): string | undefined {
  for (const n of names) { const v = process.env[n]; if (v) return v; }
  return undefined;
}
export const groqKey = () => env("GROQ_API_KEY", "Groq_api_key", "groq_api_key");
export const openaiKey = () => env("OPENAI_API_KEY", "openai_api_key", "OpenAI_api_key");
export const geminiTextKey = () => env("GEMINI_API_KEY", "gemini_api_key", "Gemini_api_key");

type ChatArgs = {
  system: string;
  user: string;
  json?: boolean;
  timeoutMs?: number;
  /** Optional product photo the model should look at (base64, no data: prefix). */
  imageBase64?: string;
  /** MIME type of imageBase64, e.g. "image/jpeg". Defaults to image/jpeg. */
  imageMime?: string;
  /** Vision fidelity. "high" lets the model actually read fine jewellery detail (stone, shape, tone) —
   *  essential for accurate titles. Defaults to "high" whenever a photo is attached. */
  imageDetail?: "low" | "high" | "auto";
  /** Sampling spread. Low = repeatable (detection/extraction); high = varied wording (title ideas). */
  temperature?: number;
};

async function chat(endpoint: string, key: string, model: string, a: ChatArgs): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), a.timeoutMs ?? 30_000);
  // When a photo is supplied, send a multimodal user message (OpenAI-compatible vision schema).
  const userContent = a.imageBase64
    ? [
        { type: "text", text: a.user },
        { type: "image_url", image_url: { url: `data:${a.imageMime ?? "image/jpeg"};base64,${a.imageBase64}`, detail: a.imageDetail ?? "high" } },
      ]
    : a.user;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: a.system }, { role: "user", content: userContent }],
        temperature: a.temperature ?? 0.7,
        ...(a.json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j: any = await res.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) throw new Error("empty completion");
    return content;
  } finally { clearTimeout(t); }
}

export function groqConfigured() { return !!groqKey(); }

/** OpenAI is ENABLED by default (billing was refilled 2026-07-06). If its billing cap is ever hit
 *  again, set OPENAI_DISABLED=1 in the Vercel env to park it — Gemini/Groq then carry everything,
 *  exactly as during the July 2026 outage. (OPENAI_ENABLED=1 also force-enables, for back-compat.) */
export function openaiEnabled() {
  const off = (process.env.OPENAI_DISABLED ?? "").trim() === "1";
  const forceOn = (process.env.OPENAI_ENABLED ?? "").trim() === "1";
  return forceOn || !off;
}
export function openaiConfigured() { return !!openaiKey() && openaiEnabled(); }

export async function groqChat(a: ChatArgs): Promise<string> {
  const key = groqKey(); if (!key) throw new Error("no groq key");
  const model = env("GROQ_MODEL") ?? "openai/gpt-oss-120b";
  return chat("https://api.groq.com/openai/v1/chat/completions", key, model, a);
}
export async function openaiChat(a: ChatArgs): Promise<string> {
  if (!openaiEnabled()) throw new Error("OpenAI disabled via OPENAI_DISABLED=1 — remove that env var to re-enable");
  const key = openaiKey(); if (!key) throw new Error("no openai key");
  // When a PHOTO is attached the model must actually SEE fine jewellery detail, so route vision calls
  // to a full multimodal model (gpt-4o) — gpt-4o-mini reads photos poorly and yields vague titles.
  // Text-only calls stay on the cheap model. Both are overridable via env.
  const model = a.imageBase64
    ? (env("OPENAI_VISION_MODEL", "OPENAI_MODEL") ?? "gpt-4o")
    : (env("OPENAI_MODEL") ?? "gpt-4o-mini");
  return chat("https://api.openai.com/v1/chat/completions", key, model, a);
}

export function geminiTextConfigured() { return !!geminiTextKey(); }

/** Gemini text reasoning (gemini-2.5-flash) — fast, capable, uses the existing GEMINI_API_KEY. */
export async function geminiChat(a: ChatArgs): Promise<string> {
  const key = geminiTextKey(); if (!key) throw new Error("no gemini key");
  // Vision (photo attached) can use a stronger model + needs more time to read fine detail; text stays fast.
  const model = a.imageBase64
    ? (env("GEMINI_VISION_MODEL", "GEMINI_TEXT_MODEL") ?? "gemini-2.5-flash")
    : (env("GEMINI_TEXT_MODEL") ?? "gemini-2.5-flash");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), a.timeoutMs ?? (a.imageBase64 ? 30_000 : 18_000));
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: `${a.system}\n\nUser command: ${a.user}` },
            ...(a.imageBase64 ? [{ inline_data: { mime_type: a.imageMime ?? "image/jpeg", data: a.imageBase64 } }] : []),
          ],
        }],
        generationConfig: { temperature: a.temperature ?? 0.3, ...(a.json ? { responseMimeType: "application/json" } : {}) },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j: any = await res.json();
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    if (!text) throw new Error("empty completion");
    return text;
  } finally { clearTimeout(t); }
}
