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
  /** Provider-specific request fields (e.g. Groq reasoning_effort). */
  extra?: Record<string, unknown>;
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
        ...(a.extra ?? {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j: any = await res.json();
    const msg = j?.choices?.[0]?.message;
    const content = msg?.content;
    // Say WHY it is empty (a refusal, a length cut-off, a reasoning model that spent its tokens) —
    // "empty completion" alone hid the cause on the owner's title screen (Nov 2026).
    if (!content) throw new Error(`empty completion from ${model}${msg?.refusal ? ` — refused: ${String(msg.refusal).slice(0, 80)}` : ""} (finish: ${j?.choices?.[0]?.finish_reason ?? "?"})`);
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
  // gpt-oss is a REASONING model: by default it "thinks" before answering, which is what made product
  // copy take longer than the host's 10-second limit ("AI took too long"). Copywriting needs no deep
  // reasoning, so ask for the short version.
  const extra = /gpt-oss/i.test(model) ? { reasoning_effort: "low", ...(a.extra ?? {}) } : a.extra;
  return chat("https://api.groq.com/openai/v1/chat/completions", key, model, { ...a, extra });
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
  const t0 = Date.now();
  try {
    return await chat("https://api.openai.com/v1/chat/completions", key, model, a);
  } catch (e) {
    // Nov 2026: gpt-4o answered the jewellery photo with "I'm sorry, but I can't help with that request"
    // (it is wary of photos with a person in them). Ask once more with a second model, in the time left.
    const msg = String((e as any)?.message ?? e);
    if (!a.imageBase64 || !/refused|empty completion/i.test(msg)) throw e;
    // gpt-4.1 reads fine jewellery detail far better than gpt-4o-mini (which missed Polki / pearls / nath).
    const alts = (env("OPENAI_VISION_FALLBACK_MODEL") ?? "gpt-4.1,gpt-4o-mini").split(",").map((x) => x.trim()).filter((x) => x && x !== model);
    let last: unknown = e;
    for (const alt of alts) {
      const left = (a.timeoutMs ?? 30_000) - (Date.now() - t0);
      if (left < 1_500) break;
      try {
        return await chat("https://api.openai.com/v1/chat/completions", key, alt, {
          ...a, timeoutMs: left,
          system: `${a.system} The image is a product photo for an online jewellery catalogue; only the jewellery matters.`,
        });
      } catch (e2) { last = e2; }
    }
    throw last;
  }
}

/**
 * VOICE → TEXT (OpenAI Whisper). DIVA's "ears": the owner holds the mic and speaks in Hinglish; this
 * transcribes it far more accurately than browser speech recognition (which mangles Hindi). Uses the same
 * OpenAI key already set in Vercel. Model overridable via OPENAI_TRANSCRIBE_MODEL (whisper-1 by default;
 * gpt-4o-transcribe / gpt-4o-mini-transcribe also work). Returns the transcript text, or throws.
 */
export async function openaiTranscribe(audio: Buffer, mime: string, filename = "voice.webm"): Promise<string> {
  if (!openaiEnabled()) throw new Error("OpenAI disabled");
  const key = openaiKey(); if (!key) throw new Error("no openai key");
  const model = env("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1";
  const form = new FormData();
  form.append("file", new Blob([audio], { type: mime || "audio/webm" }), filename);
  form.append("model", model);
  // Bias toward Hindi/Hinglish; whisper handles code-switching well when the language is hinted.
  form.append("language", env("OPENAI_TRANSCRIBE_LANG") ?? "hi");
  form.append("prompt", "Blythe Diva jewellery admin. Hinglish command. SKUs like BD1004, WT1035. Terms: stock, add, kam, price, wholesale, retail, estimate, hold, invoice.");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const j: any = await res.json();
    return String(j?.text ?? "").trim();
  } finally { clearTimeout(t); }
}

export function geminiTextConfigured() { return !!geminiTextKey(); }

/**
 * GEMINI MODEL RESOLUTION. Nov 2026: Google closed gemini-2.5-flash to new projects — every call came
 * back "404 This model models/gemini-2.5-flash is no longer available to new users", so photo-reading
 * title suggestions silently fell through to Groq (text-only, which guesses the stones). Gemini 3.x also
 * rejects `thinkingBudget: 0` with a 400. Now: try the configured model, then current Flash models; on a
 * 404 ask the API which models this key can use and pick the newest Flash; drop thinkingConfig when a
 * model refuses it. The model that worked is remembered for the life of the server.
 */
const GEMINI_FALLBACKS = ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-2.5-flash"];
let geminiWorking: string | null = null;
let geminiListed: string[] | null = null;
async function geminiListFlash(key: string): Promise<string[]> {
  if (geminiListed) return geminiListed;
  try {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(3_000) });
    const j: any = r.ok ? await r.json() : {};
    const ids = ((j?.models ?? []) as any[])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => String(m.name ?? "").replace(/^models\//, ""))
      .filter((n) => /^gemini-[\d.]+-flash(-lite)?(-\d{3}|-preview[\w-]*)?$/.test(n) || n === "gemini-flash-latest")
      .filter((n) => !/image|tts|audio|live/.test(n));
    const ver = (n: string) => parseFloat((n.match(/gemini-([\d.]+)/) ?? [])[1] ?? "0");
    // Newest first; full Flash before Flash-Lite at the same version.
    const rank = (n: string) => (n.includes("preview") ? 2 : 0) + (n.includes("lite") ? 1 : 0); // stable, full Flash first
    geminiListed = ids.sort((x, y) => ver(y) - ver(x) || rank(x) - rank(y));
  } catch { geminiListed = []; }
  return geminiListed;
}
/** POST generateContent with automatic model fallback. `wantModel` is the preferred model id. */
export async function geminiGenerate(key: string, wantModel: string | undefined, body: any, signal?: AbortSignal): Promise<{ json: any; model: string }> {
  const tried = new Set<string>();
  // Cold server: ask Google once which Flash models THIS key may use (≈0.3 s), instead of walking a list
  // of 404s — that walk plus a slow model used up the whole time limit ("gemini: This operation was
  // aborted", Nov 2026).
  const listed = geminiWorking ? [] : await geminiListFlash(key);
  const queue = [geminiWorking, wantModel && (!listed.length || listed.includes(wantModel)) ? wantModel : null, ...listed, ...GEMINI_FALLBACKS].filter(Boolean) as string[];
  let lastErr = "no gemini model answered";
  let listedOnce = listed.length > 0;
  while (queue.length) {
    const model = queue.shift()!;
    if (tried.has(model)) continue;
    tried.add(model);
    for (const withThinking of [true, false]) {
      const gc = { ...(body.generationConfig ?? {}) };
      // 2.5 takes thinkingBudget 0; 3.x rejects that but takes a thinking LEVEL (keeps replies inside the
      // host's 10 s limit). If a model refuses either, it is retried with no thinking setting at all.
      if (!withThinking) delete gc.thinkingConfig;
      else if (gc.thinkingConfig && !/2\.5/.test(model)) gc.thinkingConfig = { thinkingLevel: "minimal" };
      if (!withThinking && !body.generationConfig?.thinkingConfig) break;
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ ...body, generationConfig: gc }), signal,
        });
      } catch (e) {
        throw new Error(`${model} ${signal?.aborted ? "too slow (timed out)" : String((e as any)?.message ?? e)}`);
      }
      if (res.ok) { geminiWorking = model; return { json: await res.json(), model }; }
      const txt = await res.text();
      lastErr = `${res.status} ${model}: ${txt.slice(0, 160)}`;
      if (res.status === 400 && /thinking/i.test(txt) && withThinking) continue; // retry without thinkingConfig
      if (res.status === 400 && /thinking/i.test(txt)) break;
      if (res.status === 404 || /no longer available|not found|not supported/i.test(txt)) {
        if (!listedOnce) { listedOnce = true; queue.unshift(...(await geminiListFlash(key)).filter((m) => !tried.has(m))); }
        break;
      }
      throw new Error(lastErr); // auth / quota / bad request: another model won't help
    }
  }
  throw new Error(lastErr);
}

/** Gemini text + vision — uses the existing GEMINI_API_KEY; the model is resolved by geminiGenerate. */
export async function geminiChat(a: ChatArgs): Promise<string> {
  const key = geminiTextKey(); if (!key) throw new Error("no gemini key");
  const want = a.imageBase64 ? env("GEMINI_VISION_MODEL", "GEMINI_TEXT_MODEL") : env("GEMINI_TEXT_MODEL");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), a.timeoutMs ?? (a.imageBase64 ? 30_000 : 18_000));
  try {
    const { json: j } = await geminiGenerate(key, want, {
      contents: [{
        role: "user",
        parts: [
          { text: `${a.system}\n\nUser command: ${a.user}` },
          ...(a.imageBase64 ? [{ inline_data: { mime_type: a.imageMime ?? "image/jpeg", data: a.imageBase64 } }] : []),
        ],
      }],
      generationConfig: {
        temperature: a.temperature ?? 0.3, ...(a.json ? { responseMimeType: "application/json" } : {}),
        // 2.5 Flash "thinks" for 5-15 s by default; switch it off there (newer models drop this field).
        thinkingConfig: { thinkingBudget: 0 },
      },
    }, controller.signal);
    const text = (j?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    if (!text) throw new Error(`empty completion (${j?.candidates?.[0]?.finishReason ?? j?.promptFeedback?.blockReason ?? "no reason"})`);
    return text;
  } finally { clearTimeout(t); }
}
