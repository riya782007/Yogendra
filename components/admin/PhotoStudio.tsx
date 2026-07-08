"use client";
/**
 * PhotoStudio — the AI Jewellery Photography Studio (mockup-faithful, fully wired).
 * Upload a raw shot → AI inspects it → generate a professional hero + angles → regenerate with
 * art-direction settings (never overwrites) → Accept / Reject / Compare / Publish.
 *
 * Concurrency: generations are tracked per-key in a `busy` Set (NOT one global lock), so the
 * operator can fire several at once — click ＋Model on five colours and they all run in parallel,
 * or hit "Generate all" to enqueue every variant. Each button only disables ITSELF while it runs.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  generateStudioImageAction, setGenerationStatusAction, publishGenerationAction, detectJewelleryAction,
  uploadBrandedImageAction, refineGenerationAction, setProductThumbnailAction, deleteGenerationAction,
} from "@/app/actions/studio";
import { addVariantImageAction } from "@/app/actions/variants";
import { uploadStorefrontPhotoAction } from "@/app/actions/media";
import { compressImage } from "@/lib/image";

// Human-readable reasons so a failed click never looks like "nothing happened".
const REASON_MSG: Record<string, string> = {
  no_key: "Add GEMINI_API_KEY or OPENAI_API_KEY to enable generation.",
  no_source: "Upload a raw photo first (Replace / manage, or Upload raw on the colour).",
  no_image: "The AI returned no image — try again.",
  not_permitted: "You don't have permission to generate images.",
  bad_input: "Something's missing — reload and try again.",
  not_found: "Product not found — reload the page.",
  upload_failed: "Generated, but saving the image failed. Try again.",
  api_error: "The image service is busy or timed out. Try again in a moment.",
};
const reasonText = (r?: string, e?: string) => e || (r ? REASON_MSG[r] ?? `Generation failed (${r}).` : "Generation failed.");

// ---- Photo-vs-label colour sanity check (client-side, best-effort) ---------------------------
// A coarse palette used to guess the dominant STONE colour of a variant's photo and compare it to
// the colour NAME on the variant, so we can warn "photo looks green but label says Black".
const PALETTE: { name: string; rgb: [number, number, number] }[] = [
  { name: "red", rgb: [190, 40, 40] }, { name: "maroon", rgb: [110, 30, 40] },
  { name: "pink", rgb: [235, 150, 185] }, { name: "magenta", rgb: [190, 40, 120] },
  { name: "purple", rgb: [110, 60, 150] }, { name: "blue", rgb: [50, 80, 185] },
  { name: "green", rgb: [45, 140, 80] }, { name: "orange", rgb: [225, 140, 50] },
  { name: "yellow", rgb: [225, 205, 70] }, { name: "brown", rgb: [120, 80, 50] },
];
/** Nearest palette colour + its squared distance (lower = more confident). */
function nearestColour(r: number, g: number, b: number): { name: string; dist: number } {
  let best = "", bd = Infinity;
  for (const c of PALETTE) { const d = (c.rgb[0] - r) ** 2 + (c.rgb[1] - g) ** 2 + (c.rgb[2] - b) ** 2; if (d < bd) { bd = d; best = c.name; } }
  return { name: best, dist: bd };
}
// Collapse near-neighbour colours so we never false-warn across an ambiguous boundary
// (baby-pink reading as magenta/purple, maroon as red, etc.).
const COLLAPSE: Record<string, string> = { magenta: "pink", maroon: "red", purple: "pink", orange: "red" };
const fold = (c: string) => COLLAPSE[c] ?? c;
/** Map a free-text variant colour label to one of the coarse families above (or "" if neutral/metal). */
function labelFamily(label: string): string {
  const t = (label || "").toLowerCase();
  if (/rani|magenta|fuchsia/.test(t)) return "magenta";
  if (/baby ?pink|pink|blush|peach|rose/.test(t)) return "pink";
  if (/maroon|wine|burgundy/.test(t)) return "maroon";
  if (/red|scarlet|ruby/.test(t)) return "red";
  if (/green|emerald|olive|mint|mehendi/.test(t)) return "green";
  if (/blue|navy|teal|sky|firozi|turquoise/.test(t)) return "blue";
  if (/purple|violet|lavender|mauve|wine/.test(t)) return "purple";
  if (/brown|coffee|tan|bronze/.test(t)) return "brown";
  if (/orange|rust/.test(t)) return "orange";
  if (/yellow|lemon|mustard/.test(t)) return "yellow";
  return ""; // black / white / gold / silver / grey → metal-ish, not judged from stones
}

type Gen = { id: string; output_path: string | null; shot_type: string; version: number; status: string; provider: string | null; settings: any; created_at: string; variant_id?: string | null };
type Data = {
  product: { id: string; sku: string; name: string; category?: { name?: string; slug?: string } };
  raw: { id: string; path: string } | null;
  images: { id: string; path: string; sort: number; kind?: string | null }[];
  generations: Gen[];
  variants?: { id: string; sku: string; color: string | null; image: string | null; images?: string[] }[];
  detected: { category?: string; material?: string; style?: string; attributes?: string[] } | null;
  thumbnailPath?: string | null;
};

const LIGHTING = ["Soft Studio Light", "Diffused Light", "Top Light for diamonds", "Warm Light for gold", "Natural Daylight"];
const MODEL_STYLE = ["Indian Model", "Western Model", "Hand Model", "No Model (Product Only)"];
const BACKGROUND = ["Warm Neutral", "Ivory Studio", "White Seamless", "Soft Cream", "Editorial Set"];
const FOCUS = ["Product + Model (Balanced)", "Product Emphasis", "Close-up Focus", "Lifestyle"];
const ANGLES: { key: string; label: string }[] = [
  { key: "closeup", label: "Close-up" }, { key: "lifestyle", label: "Lifestyle" }, { key: "side", label: "Side View" },
  { key: "angle45", label: "45°" }, { key: "back", label: "Back View" }, { key: "detail", label: "Detail" },
  { key: "model", label: "Model Shot" }, { key: "catalog_white", label: "Catalog White" },
];
const ENHANCERS: { key: string; label: string; desc: string }[] = [
  { key: "enhance_shadows", label: "Add natural shadows", desc: "Adds depth and realism" },
  { key: "enhance_sparkle", label: "Enhance sparkle", desc: "Boosts gemstone brilliance" },
  { key: "remove_bg", label: "Remove background", desc: "Clean white product cutout" },
  { key: "upscale", label: "Upscale resolution", desc: "Increase image quality" },
  { key: "transparent", label: "Transparent PNG", desc: "Isolated for catalogs" },
  { key: "social_crop", label: "Social media crop", desc: "Square crop for posts" },
];
const sel = "w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

export function PhotoStudio({ data, ready }: { data: Data; ready: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const p = data.product;
  // Per-key busy set — multiple generations can be in flight at once (queued by the operator).
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);
  // Per-variant "recolour to the colour NAME" toggle (default off = the uploaded photo wins).
  const [recolor, setRecolor] = useState<Record<string, boolean>>({});
  // Guessed dominant stone colour per variant + dismissed mismatch warnings.
  const [guess, setGuess] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  /** Best-effort: load the variant photo cross-origin, sample its centre, and guess the dominant
   *  STONE colour (ignoring near-neutral metal/background pixels). Used only to warn on a
   *  photo-vs-label mismatch; silently skips if the image can't be read (CORS) or is too neutral. */
  function checkColour(variantId: string, url: string) {
    if (guess[variantId] || !url) return;
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      try {
        const S = 28; const c = document.createElement("canvas"); c.width = S; c.height = S;
        const ctx = c.getContext("2d"); if (!ctx) return;
        ctx.drawImage(im, im.naturalWidth * 0.2, im.naturalHeight * 0.2, im.naturalWidth * 0.6, im.naturalHeight * 0.6, 0, 0, S, S);
        const d = ctx.getImageData(0, 0, S, S).data;
        let r = 0, g = 0, b = 0, n = 0;
        const total = (S * S);
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B);
          if (mx - mn > 70) { r += R; g += G; b += B; n++; } // STRONGLY saturated → a coloured stone
        }
        // Only judge when a clear majority of the centre is a vivid colour (avoids metal/neutral noise),
        // AND the average is confidently close to a known colour. Otherwise stay silent (no warning).
        if (n < total * 0.18) return;
        const { name, dist } = nearestColour(r / n, g / n, b / n);
        if (dist > 3500) return; // ambiguous → don't guess
        setGuess((x) => ({ ...x, [variantId]: name }));
      } catch { /* tainted canvas / CORS — skip */ }
    };
    im.src = url;
  }

  const isBusy = (key: string) => busy.has(key);
  const anyBusy = busy.size > 0;
  const addBusy = (key: string) => setBusy((b) => { const n = new Set(b); n.add(key); return n; });
  const dropBusy = (key: string) => setBusy((b) => { const n = new Set(b); n.delete(key); return n; });

  // Optimistic results — the URL returned by each generation, shown INSTANTLY so display never
  // depends on a router.refresh() that could cancel other in-flight generations.
  const [results, setResults] = useState<Record<string, string>>({});
  const slot = (shotType: string, variantId?: string) => `${shotType}:${variantId ?? "_"}`;

  // "Fix a detail" — the candidate the owner is surgically editing (mark + comment). Null = closed.
  const [refineGen, setRefineGen] = useState<Gen | null>(null);
  const openRefine = (g?: Gen | null) => { if (g?.output_path) setRefineGen(g); };

  // Storefront cover (card thumbnail) chooser. null = automatic (first generated photo).
  const [cover, setCover] = useState<string | null>(data.thumbnailPath ?? null);
  const [coverBusy, setCoverBusy] = useState(false);
  // Every image the owner may pick as the cover: generated product photos + every colour's photos.
  const coverOptions: { url: string; label: string }[] = (() => {
    const out: { url: string; label: string }[] = [];
    const seen = new Set<string>();
    const add = (url?: string | null, label?: string) => {
      if (url && url.startsWith("http") && !seen.has(url)) { seen.add(url); out.push({ url, label: label ?? "" }); }
    };
    (data.images ?? []).forEach((i) => { if (i.kind !== "source" && i.kind !== "flatlay") add(i.path, "Photo"); });
    (data.variants ?? []).forEach((v) => (v.images ?? []).forEach((u) => add(u, v.color ?? v.sku)));
    return out;
  })();
  async function chooseCover(url: string | null) {
    setCoverBusy(true);
    try {
      const r = await setProductThumbnailAction({ productId: p.id, url: url ?? "" });
      if (r.ok) { setCover(url); toast(url ? "Storefront cover updated ✓" : "Cover set to automatic ✓", "success"); scheduleRefresh(); }
      else { toast(r.reason === "not_an_image_of_this_product" ? "That image isn't on this product." : (r.reason ? `Couldn't set cover (${r.reason})` : "Couldn't set the cover"), "error"); }
    } catch { toast("Network error — try again.", "error"); }
    finally { setCoverBusy(false); }
  }
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = () => { if (refreshTimer.current) clearTimeout(refreshTimer.current); refreshTimer.current = setTimeout(() => router.refresh(), 1500); };

  // Emergency / manual override: upload a FINISHED photo and show it on the storefront now (used when
  // AI generation is down, or the owner already has a ready shot).
  const readyRef = useRef<HTMLInputElement>(null);
  async function uploadReadyHero(file: File | undefined) {
    if (!file) return;
    const key = "ready-hero"; addBusy(key); setErr("");
    try {
      const small = await compressImage(file);
      const fd = new FormData(); fd.set("sku", p.sku); fd.set("image", small);
      const r = await uploadStorefrontPhotoAction(fd);
      if (r.ok) { toast("Photo published to the site ✓", "success"); router.refresh(); }
      else { const m = r.error || "Upload failed."; setErr(m); toast(m, "error"); }
    } catch { toast("Upload failed — try a smaller photo", "error"); }
    finally { dropBusy(key); }
  }

  // Art-direction settings.
  const [lighting, setLighting] = useState(LIGHTING[0]);
  const [modelStyle, setModelStyle] = useState(MODEL_STYLE[0]);
  const [background, setBackground] = useState(BACKGROUND[0]);
  const [focus, setFocus] = useState(FOCUS[0]);
  const [ethnicity, setEthnicity] = useState("");
  const [pose, setPose] = useState("");
  const [makeup, setMakeup] = useState("");
  const [mood, setMood] = useState("");
  // FULL-SET support: which pieces this SKU includes (necklace + earrings + maang tikka + ring…)
  // and the owner's free-text shoot brief. Both are saved with every generation's settings, so we
  // seed them from the most recent generation — the owner sets them once per product.
  const lastWithSet = (data.generations ?? []).find((g: any) => (g.settings?.setPieces?.length ?? 0) > 0 || g.settings?.customPrompt);
  const [setPieces, setSetPieces] = useState<string[]>(lastWithSet?.settings?.setPieces ?? []);
  const [customPrompt, setCustomPrompt] = useState<string>(lastWithSet?.settings?.customPrompt ?? "");
  const [customPiece, setCustomPiece] = useState("");
  const PIECES = ["Necklace", "Earrings", "Maang Tikka", "Ring", "Bracelet", "Bangles", "Nath", "Kamarband"];
  const togglePiece = (v: string) => setSetPieces((p) => p.some((x) => x.toLowerCase() === v.toLowerCase()) ? p.filter((x) => x.toLowerCase() !== v.toLowerCase()) : [...p, v]);

  const styleParam: "auto" | "indian" | "western" = modelStyle.startsWith("Western") ? "western" : modelStyle.startsWith("Indian") ? "indian" : "auto";
  const settings = () => ({ lighting, modelStyle, background, focus, ethnicity, pose, makeup, mood, emphasis: focus, setPieces, customPrompt });

  const candidatesOf = (shot: string) => data.generations.filter((g) => g.shot_type === shot && g.output_path && g.status !== "rejected" && g.status !== "archived");
  const heroCandidates = candidatesOf("hero");
  const hero = heroCandidates.find((g) => g.status === "published") ?? heroCandidates.find((g) => g.status === "favorite") ?? heroCandidates[0] ?? null;
  const heroUrl = results[slot("hero")] ?? hero?.output_path ?? data.images[0]?.path ?? data.raw?.path ?? null;

  const variants = data.variants ?? [];

  /** Fire one generation. Concurrency-safe: adds its own key to `busy`, so other buttons stay live
   *  and the operator can queue several at once. Returns true on success (used by "Generate all"). */
  async function gen(shotType: string, key: string, variantId?: string, opts?: { matchColorName?: boolean; silent?: boolean }): Promise<boolean> {
    if (!ready) { const m = REASON_MSG.no_key; setErr(m); toast(m, "error"); return false; }
    if (!data.raw && data.images.length === 0 && !variants.some((v) => v.image)) { const m = REASON_MSG.no_source; setErr(m); toast(m, "error"); return false; }
    if (isBusy(key)) return false; // already running this exact shot
    setErr(""); addBusy(key);
    try {
      const r = await generateStudioImageAction({ productId: p.id, shotType: shotType as any, settings: settings(), style: styleParam, variantId, matchColorName: opts?.matchColorName });
      if (!r.ok) { const m = reasonText(r.reason, r.error); setErr(m); toast(m, "error"); return false; }
      if (r.url) setResults((x) => ({ ...x, [slot(shotType, variantId)]: r.url! })); // show instantly
      if (!opts?.silent) toast("Image generated ✓", "success");
      scheduleRefresh(); // sync DB status/candidates shortly, without cancelling other in-flight gens
      return true;
    } catch {
      const m = "Network error — try again."; setErr(m); toast(m, "error"); return false;
    } finally {
      dropBusy(key);
    }
  }

  /** Bulk: run a shot for EVERY variant, ONE AT A TIME. Server Actions are serialized by Next.js and
   *  a mid-batch refresh cancels queued ones — so we await each fully, then refresh once at the end.
   *  Every colour reliably gets its image (slower, but nothing is dropped). */
  async function genAllVariants(shotType: "model" | "branded_stand") {
    if (!ready) { const m = REASON_MSG.no_key; setErr(m); toast(m, "error"); return; }
    if (!variants.length) return;
    const prefix = shotType === "model" ? "vm" : "vs";
    toast(`Generating ${variants.length} ${shotType === "model" ? "model" : "stand"} shots one by one…`, "info");
    let done = 0;
    for (const v of variants) {
      const ok = await gen(shotType, `${prefix}-${v.id}`, v.id, { matchColorName: !!recolor[v.id], silent: true });
      if (ok) done++; // each result shows instantly via optimistic state; no mid-loop refresh to cancel others
    }
    toast(`Bulk done — ${done}/${variants.length} generated ✓`, done === variants.length ? "success" : "info");
    scheduleRefresh();
  }

  /** Upload a real raw reference photo for ONE colour, so generation uses the true piece — not an
   *  AI-assumed colourway. Stored on the variant's own image_paths (what generation reads first). */
  async function uploadRaw(variantId: string, files: FileList | null) {
    if (!files || !files.length) return;
    const key = `up-${variantId}`;
    addBusy(key); setErr("");
    try {
      const fd = new FormData();
      fd.set("id", variantId);
      fd.set("product_sku", p.sku);
      Array.from(files).forEach((f) => fd.append("images", f));
      const r = await addVariantImageAction(fd);
      if (!r.ok) { const m = r.error || "Upload failed."; setErr(m); toast(m, "error"); }
      else { toast("Raw photo added — generate now uses it ✓", "success"); router.refresh(); }
    } catch {
      const m = "Upload failed — try again."; setErr(m); toast(m, "error");
    } finally {
      dropBusy(key);
    }
  }

  /** Publish the generated stand shot. The "blythediva" wordmark is now printed ON the display bust
   *  by the AI, so we publish the shot AS-IS (no caption overlay beneath the image). */
  async function brandAndPublish(imageUrl: string, variantId: string | null, key: string) {
    setErr(""); addBusy(key);
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("load")); img.src = imageUrl; });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const base64 = dataUrl.split(",")[1];
      const r = await uploadBrandedImageAction({ productId: p.id, variantId, base64, mime: "image/jpeg", shotType: "branded_stand" });
      if (!r.ok) { const m = reasonText(r.reason, r.error) || "Could not brand & publish."; setErr(m); toast(m, "error"); }
      else { toast("Branded & published ✓", "success"); router.refresh(); }
    } catch {
      const m = "Couldn't process the image (cross-origin). Try re-generating."; setErr(m); toast(m, "error");
    } finally {
      dropBusy(key);
    }
  }

  function redetect() {
    const key = "detect"; addBusy(key);
    toast("Re-checking the piece…", "info");
    (async () => { try { await detectJewelleryAction(p.id); toast("Re-detected ✓", "success"); router.refresh(); } finally { dropBusy(key); } })();
  }

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6 max-w-6xl">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Link href="/admin/media" className="text-sm text-muted hover:text-ink">← All product photos</Link>
          {data.detected && <span className="text-[11px] text-muted">AI detected: <b className="text-ink capitalize">{[data.detected.category, data.detected.material, data.detected.style].filter(Boolean).join(" · ")}</b> <button onClick={redetect} className="ml-1 text-emerald nav-link">re-detect</button></span>}
        </div>
        <h1 className="font-display text-3xl text-ink">Product Photos</h1>
        <p className="text-sm text-muted mb-3">Upload the raw design shot → generate a ready-to-publish professional model photo → add angles. The AI reproduces your design exactly.</p>
        <div className={`rounded-xl px-4 py-2 mb-4 text-sm ${ready ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>
          {ready ? "● AI photo generation connected — Gemini, with OpenAI fallback." : "○ Not connected — add GEMINI_API_KEY or OPENAI_API_KEY to generate. You can still upload raw photos."}
        </div>
        {err && <div className="rounded-xl px-4 py-2 mb-4 text-sm bg-rose/10 text-rose">{err}</div>}
        {anyBusy && <div className="rounded-xl px-4 py-2 mb-4 text-sm bg-ink/5 text-ink flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-emerald animate-pulse" />{busy.size} generation{busy.size === 1 ? "" : "s"} running — you can keep queuing more.</div>}

        {/* Sticky section nav — jump around this long page without endless scrolling. */}
        <nav className="sticky top-2 z-20 mb-4 flex flex-wrap gap-1.5 rounded-full border border-sand bg-white/90 backdrop-blur px-2 py-1.5 shadow-card text-xs">
          {[
            { href: "#studio-hero", label: "Hero" },
            { href: "#studio-angles", label: "Angles" },
            ...(variants.length ? [{ href: "#studio-variants", label: "Variant photos" }] : []),
            { href: "#studio-enhance", label: "Enhance" },
          ].map((t) => (
            <a key={t.href} href={t.href} className="px-3 py-1 rounded-full text-muted hover:bg-cream hover:text-ink transition-colors">{t.label}</a>
          ))}
        </nav>

        {/* Main studio card */}
        <div id="studio-hero" className="scroll-mt-16 bg-white rounded-2xl border border-sand shadow-card p-5">
          <div className="flex items-start gap-2 mb-3">
            <div>
              <p className="font-medium text-ink">{p.name}</p>
              <p className="text-xs text-muted">{p.category?.name} · {p.sku}</p>
            </div>
            {/* Jump straight to the live product page the customer sees (opens in a new tab so the
                studio stays open). Uses the category slug + SKU route. */}
            <a
              href={`/shop/${p.category?.slug ?? "all"}/${p.sku}`}
              target="_blank" rel="noopener noreferrer"
              className="ml-auto shrink-0 px-3 py-1.5 rounded-full bg-emerald-mist text-emerald-dark text-xs font-medium hover:bg-emerald/20 whitespace-nowrap"
              title="Open this product's live view page in a new tab"
            >
              View product page ↗
            </a>
          </div>

          <div className="grid sm:grid-cols-[120px_1fr_220px] gap-4">
            {/* Raw */}
            <div>
              <p className="text-[11px] text-muted mb-1">⬆ Raw uploaded</p>
              <div className="aspect-[4/5] rounded-xl bg-cream border border-sand overflow-hidden">
                {data.raw ? <img src={data.raw.path} alt="raw" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[10px] text-muted text-center px-2">No raw yet</div>}
              </div>
              <Link href="/admin/media" className="block text-center text-[11px] text-emerald nav-link mt-1">Replace / manage</Link>
            </div>

            {/* Hero */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-[11px] text-muted">AI Generated Hero</p>
                {hero && <span className="text-[9px] uppercase tracking-wide bg-emerald-mist text-emerald-dark px-1.5 py-0.5 rounded-full">{hero.status === "published" ? "Published" : "Best for website"}</span>}
              </div>
              <div className="aspect-[4/5] rounded-xl bg-cream border border-sand overflow-hidden relative">
                {heroUrl ? <img src={heroUrl} alt="hero" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-xs text-muted">Generate a hero →</div>}
                {isBusy("hero") && <div className="absolute inset-0 bg-ink/40 grid place-items-center text-cream text-sm">Generating…</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                {heroUrl && <a href={heroUrl} target="_blank" className="px-2 py-1 rounded-lg bg-ink/5 hover:bg-ink/10">View</a>}
                {heroUrl && <a href={heroUrl} download className="px-2 py-1 rounded-lg bg-ink/5 hover:bg-ink/10">⬇ Download</a>}
                <button onClick={() => gen("hero", "hero")} disabled={isBusy("hero")} className="px-2 py-1 rounded-lg bg-gold/15 text-gold-dark hover:bg-gold/25 disabled:opacity-50">{isBusy("hero") ? "…" : "⟳ Regenerate"}</button>
                {/* Emergency manual upload — bypasses AI, shows straight on the site. */}
                <input ref={readyRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadReadyHero(e.target.files?.[0])} />
                <button onClick={() => readyRef.current?.click()} disabled={isBusy("ready-hero")} className="px-2 py-1 rounded-lg border border-emerald text-emerald-dark hover:bg-emerald-mist disabled:opacity-50" title="Upload a ready photo and show it on the site now — no AI needed">{isBusy("ready-hero") ? "…" : "⬆ Upload photo"}</button>
                {hero && <button onClick={() => openRefine(hero)} className="px-2 py-1 rounded-lg bg-emerald-mist text-emerald-dark hover:bg-emerald/20" title="Mark a wrong area and tell the AI what to fix — only that spot changes">✏️ Fix a detail</button>}
                {hero && hero.status !== "published" && (
                  <form action={publishGenerationAction}><input type="hidden" name="id" value={hero.id} /><button className="px-2 py-1 rounded-lg bg-emerald text-white">Publish</button></form>
                )}
              </div>
              {/* Hero candidates (A/B, never overwritten) */}
              {heroCandidates.length > 1 && (
                <div className="flex gap-1.5 mt-2 overflow-x-auto">
                  {heroCandidates.map((g) => (
                    <div key={g.id} className="shrink-0 w-14">
                      <div className={`aspect-[4/5] rounded-lg overflow-hidden border ${g.status === "published" ? "border-emerald ring-1 ring-emerald" : g.status === "favorite" ? "border-gold" : "border-sand"}`}>
                        {g.output_path && <img src={g.output_path} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="flex gap-0.5 mt-0.5">
                        <StatusBtn id={g.id} status="favorite" title="★" />
                        <StatusBtn id={g.id} status="rejected" title="✕" />
                        <DeleteGenBtn id={g.id} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Regenerate settings */}
            <div>
              <p className="text-[11px] font-medium text-ink mb-1.5">Regenerate settings</p>

              {/* FULL SET — tick every piece this SKU includes so the AI keeps ALL of them in frame
                  (fixes generations cropping out the maang tikka / ring from a set). */}
              <p className="text-[10px] text-muted">Pieces included in this SKU {setPieces.length >= 2 && <span className="text-emerald-dark font-medium">· full set of {setPieces.length} — all kept in frame</span>}</p>
              <div className="flex flex-wrap gap-1 mt-1 mb-1.5">
                {PIECES.map((o) => {
                  const on = setPieces.some((x) => x.toLowerCase() === o.toLowerCase());
                  return <button key={o} type="button" onClick={() => togglePiece(o)} className={`text-[10px] px-2 py-0.5 rounded-full border ${on ? "bg-emerald text-white border-emerald" : "border-sand text-muted hover:border-emerald"}`}>{on ? "✓ " : ""}{o}</button>;
                })}
                {setPieces.filter((x) => !PIECES.some((o) => o.toLowerCase() === x.toLowerCase())).map((o) => (
                  <button key={o} type="button" onClick={() => togglePiece(o)} className="text-[10px] px-2 py-0.5 rounded-full border bg-emerald text-white border-emerald">✓ {o}</button>
                ))}
                <input value={customPiece} onChange={(e) => setCustomPiece(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && customPiece.trim()) { togglePiece(customPiece.trim()); setCustomPiece(""); } }}
                  placeholder="+ other piece ⏎" className="text-[10px] px-2 py-0.5 rounded-full border border-dashed border-sand outline-none focus:border-emerald w-24" />
              </div>

              {/* Owner's shoot brief — appended verbatim to every generation prompt. */}
              <textarea value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} rows={2}
                placeholder="Shoot brief (optional) — e.g. replicate the raw photo's layout exactly; show the full set laid on ivory silk; tikka centred on the parting…"
                className={`${sel} mb-1.5 resize-y`} />

              <label className="text-[10px] text-muted">Lighting style<select value={lighting} onChange={(e) => setLighting(e.target.value)} className={`${sel} mt-0.5`}>{LIGHTING.map((o) => <option key={o}>{o}</option>)}</select></label>
              <label className="text-[10px] text-muted block mt-1.5">Model style<select value={modelStyle} onChange={(e) => setModelStyle(e.target.value)} className={`${sel} mt-0.5`}>{MODEL_STYLE.map((o) => <option key={o}>{o}</option>)}</select></label>
              <label className="text-[10px] text-muted block mt-1.5">Background<select value={background} onChange={(e) => setBackground(e.target.value)} className={`${sel} mt-0.5`}>{BACKGROUND.map((o) => <option key={o}>{o}</option>)}</select></label>
              <label className="text-[10px] text-muted block mt-1.5">Focus<select value={focus} onChange={(e) => setFocus(e.target.value)} className={`${sel} mt-0.5`}>{FOCUS.map((o) => <option key={o}>{o}</option>)}</select></label>
              <button onClick={() => setMore((m) => !m)} className="text-[10px] text-emerald nav-link mt-1.5">{more ? "Fewer settings" : "More settings"}</button>
              {more && (
                <div className="space-y-1.5 mt-1.5">
                  <input value={ethnicity} onChange={(e) => setEthnicity(e.target.value)} placeholder="Model ethnicity" className={sel} />
                  <input value={pose} onChange={(e) => setPose(e.target.value)} placeholder="Pose" className={sel} />
                  <input value={makeup} onChange={(e) => setMakeup(e.target.value)} placeholder="Makeup" className={sel} />
                  <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="Mood" className={sel} />
                </div>
              )}
              <button onClick={() => gen("hero", "hero")} disabled={isBusy("hero")} className="w-full mt-2 px-3 py-2 rounded-xl bg-ink text-white text-sm disabled:opacity-50">{isBusy("hero") ? "Generating…" : "✦ Regenerate image"}</button>
            </div>
          </div>

          {/* Storefront cover — the owner chooses which photo (incl. a specific colour) is the card thumbnail. */}
          <div className="mt-6 border-t border-sand pt-4">
            <p className="text-sm font-medium text-ink">Storefront cover <span className="text-muted font-normal">· the thumbnail customers see on the shop</span></p>
            <p className="text-[11px] text-muted mb-2">Pick any photo — including a specific colour — as the cover, or leave it Automatic (the first generated photo).</p>
            {coverOptions.length === 0 ? (
              <p className="text-[11px] text-muted">Generate or upload a photo first, then choose your cover here.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => chooseCover(null)} disabled={coverBusy}
                  className={`w-16 h-20 rounded-lg border grid place-items-center text-[10px] text-center leading-tight disabled:opacity-50 ${cover === null ? "border-emerald ring-2 ring-emerald bg-emerald-mist/30 text-emerald-dark" : "border-sand text-muted hover:border-emerald"}`}>
                  Auto{cover === null ? " ✓" : ""}
                </button>
                {coverOptions.map((o) => (
                  <button key={o.url} type="button" onClick={() => chooseCover(o.url)} disabled={coverBusy}
                    className={`relative w-16 h-20 rounded-lg overflow-hidden border disabled:opacity-50 ${cover === o.url ? "border-emerald ring-2 ring-emerald" : "border-sand hover:border-emerald"}`}
                    title={`Set ${o.label || "this photo"} as the storefront cover`}>
                    <img src={o.url} alt={o.label} className="w-full h-full object-cover" />
                    {cover === o.url && <span className="absolute top-0.5 left-0.5 text-[8px] bg-emerald text-white px-1 rounded">Cover</span>}
                    {o.label && o.label !== "Photo" && <span className="absolute bottom-0 inset-x-0 bg-ink/55 text-white text-[8px] py-0.5 text-center truncate px-0.5">{o.label}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Additional angles */}
          <div id="studio-angles" className="scroll-mt-16 mt-6">
            <p className="text-sm font-medium text-ink mb-2">Additional angles</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {ANGLES.map((a) => {
                const cand = candidatesOf(a.key);
                const top = cand.find((g) => g.status === "published") ?? cand[0];
                const angleUrl = results[slot(a.key)] ?? top?.output_path;
                return (
                  <div key={a.key}>
                    <div className="aspect-[4/5] rounded-lg bg-cream border border-sand overflow-hidden relative">
                      {angleUrl ? <img src={angleUrl} alt={a.label} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[9px] text-muted text-center">{a.label}</div>}
                      {isBusy(a.key) && <div className="absolute inset-0 bg-ink/40 grid place-items-center text-cream text-[10px]">…</div>}
                    </div>
                    <div className="flex items-center justify-between gap-1 mt-0.5">
                      <button onClick={() => gen(a.key, a.key)} disabled={isBusy(a.key)} className="text-[10px] text-gold-dark hover:underline disabled:opacity-50">{isBusy(a.key) ? "…" : (cand.length ? "⟳ Regen" : "Make")}</button>
                      {top && <button onClick={() => openRefine(top)} className="text-[10px] text-emerald-dark hover:underline" title="Fix a detail on this shot">✏️ Fix</button>}
                      {top && top.status !== "published" && <form action={publishGenerationAction}><input type="hidden" name="id" value={top.id} /><button className="text-[10px] text-emerald">Pub</button></form>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Variant AI photos — 1 model shot + 1 branded on-stand shot per colour */}
          {variants.length > 0 && (
            <div id="studio-variants" className="scroll-mt-16 mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <p className="text-sm font-medium text-ink">Variant photos <span className="text-muted font-normal">· model + branded stand per colour</span></p>
                {/* Bulk: enqueue every colour at once. */}
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-muted">Bulk:</span>
                  <button onClick={() => genAllVariants("model")} disabled={!ready} className="px-2.5 py-1 rounded-full bg-ink text-white disabled:opacity-40">Generate all — Model</button>
                  <button onClick={() => genAllVariants("branded_stand")} disabled={!ready} className="px-2.5 py-1 rounded-full bg-ink/80 text-white disabled:opacity-40">Generate all — Stand</button>
                </div>
              </div>
              <p className="text-[11px] text-muted mb-2">Generates from each colour&apos;s own photo. <b>Tip:</b> use <b>Upload raw</b> on a colour to give the AI the true photo instead of letting it assume the colourway. The stand shot gets the <b>blythediva</b> wordmark on publish. You can queue several at once.</p>
              <div className="space-y-2">
                {variants.map((v) => {
                  const vModel = data.generations.find((g) => g.variant_id === v.id && g.shot_type === "model" && g.output_path && g.status !== "rejected" && g.status !== "archived");
                  const vStand = data.generations.find((g) => g.variant_id === v.id && g.shot_type === "branded_stand" && g.output_path && g.status !== "rejected" && g.status !== "archived");
                  const upKey = `up-${v.id}`;
                  const vModelUrl = results[slot("model", v.id)] ?? vModel?.output_path;
                  const vStandUrl = results[slot("branded_stand", v.id)] ?? vStand?.output_path;
                  const fam = labelFamily(v.color ?? "");
                  // Only a CONFIDENT, clearly-different colour warns (near-neighbours are folded together).
                  const mismatch = !!guess[v.id] && !!fam && fold(fam) !== fold(guess[v.id]) && !dismissed.has(v.id);
                  return (
                    <div key={v.id} className="rounded-xl border border-sand p-2.5">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-12 rounded-lg overflow-hidden bg-cream shrink-0 relative">
                          {v.image ? <img src={v.image} alt={v.color ?? v.sku} onLoad={() => checkColour(v.id, v.image!)} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[8px] text-muted text-center">no raw</div>}
                        </div>
                        <div className="min-w-[110px]">
                          <p className="text-sm text-ink">{v.color ?? v.sku}</p>
                          <p className="text-[10px] text-muted font-mono">{v.sku}</p>
                          {/* Upload the true raw reference for this colour */}
                          <label className={`inline-block mt-0.5 text-[10px] cursor-pointer ${isBusy(upKey) ? "text-muted" : "text-emerald hover:underline"}`}>
                            {isBusy(upKey) ? "Uploading…" : (v.image ? "↺ Replace raw" : "⬆ Upload raw")}
                            <input type="file" accept="image/*" multiple className="hidden" disabled={isBusy(upKey)}
                              onChange={(e) => { uploadRaw(v.id, e.target.files); e.currentTarget.value = ""; }} />
                          </label>
                        </div>
                        {/* Model */}
                        <div className="text-center">
                          {vModelUrl
                            ? <img src={vModelUrl} alt="model" className="w-10 h-12 rounded object-cover inline-block" />
                            : <div className="w-10 h-12 rounded bg-cream inline-grid place-items-center text-[9px] text-muted relative">{isBusy(`vm-${v.id}`) && <span className="absolute inset-0 grid place-items-center bg-ink/30 text-cream text-[9px]">…</span>}model</div>}
                          <button onClick={() => gen("model", `vm-${v.id}`, v.id, { matchColorName: !!recolor[v.id] })} disabled={isBusy(`vm-${v.id}`)} className="block text-[10px] text-gold-dark hover:underline mt-0.5 w-full disabled:opacity-50">{isBusy(`vm-${v.id}`) ? "…" : (vModelUrl ? "⟳ Model" : "＋ Model")}</button>
                          {vModel && <button onClick={() => openRefine(vModel)} className="block text-[10px] text-emerald-dark hover:underline w-full" title="Fix a detail on this model shot">✏️ Fix</button>}
                        </div>
                        {/* Branded stand */}
                        <div className="text-center">
                          {vStandUrl
                            ? <img src={vStandUrl} alt="stand" className="w-10 h-12 rounded object-cover inline-block" />
                            : <div className="w-10 h-12 rounded bg-cream inline-grid place-items-center text-[9px] text-muted relative">{isBusy(`vs-${v.id}`) && <span className="absolute inset-0 grid place-items-center bg-ink/30 text-cream text-[9px]">…</span>}stand</div>}
                          <button onClick={() => gen("branded_stand", `vs-${v.id}`, v.id, { matchColorName: !!recolor[v.id] })} disabled={isBusy(`vs-${v.id}`)} className="block text-[10px] text-gold-dark hover:underline mt-0.5 w-full disabled:opacity-50">{isBusy(`vs-${v.id}`) ? "…" : (vStandUrl ? "⟳ Stand" : "＋ Stand")}</button>
                        </div>
                        {vStandUrl && vStand?.status !== "published" && (
                          <button onClick={() => brandAndPublish(vStandUrl, v.id, `br-${v.id}`)} disabled={isBusy(`br-${v.id}`)} className="ml-auto px-2.5 py-1.5 rounded-lg bg-emerald text-white text-[11px] disabled:opacity-50">
                            {isBusy(`br-${v.id}`) ? "Branding…" : "Brand & Publish"}
                          </button>
                        )}
                        {vStand?.status === "published" && <span className="ml-auto text-[11px] text-emerald-dark">✓ Branded</span>}
                      </div>
                      {/* Colour handling: photo wins by default; toggle to force-recolour to the label. */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 pl-1 text-[11px]">
                        <label className="flex items-center gap-1.5 text-muted cursor-pointer">
                          <input type="checkbox" checked={!!recolor[v.id]} onChange={(e) => setRecolor((x) => ({ ...x, [v.id]: e.target.checked }))} className="accent-emerald" />
                          Recolour to “{v.color ?? "label"}” (ignore the photo&apos;s colour)
                        </label>
                        {mismatch && (
                          <span className="flex items-center gap-1.5 text-gold-dark bg-gold/10 rounded-full px-2.5 py-0.5">
                            ⚠ Photo looks <b>{guess[v.id]}</b>, label says <b>{v.color}</b> — {recolor[v.id] ? `will recolour to ${v.color}` : "using the photo as-is"}.
                            <button onClick={() => setDismissed((s) => new Set(s).add(v.id))} className="ml-1 hover:text-ink" title="Dismiss">✕</button>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* AI enhancement options */}
          <div id="studio-enhance" className="scroll-mt-16 mt-6">
            <p className="text-sm font-medium text-ink mb-2">AI enhancement options</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ENHANCERS.map((e) => (
                <button key={e.key} onClick={() => gen(e.key, e.key)} disabled={isBusy(e.key)}
                  className="text-left rounded-xl border border-sand bg-white p-3 hover:border-emerald disabled:opacity-50">
                  <p className="text-sm text-ink">{isBusy(e.key) ? "Generating…" : e.label}</p>
                  <p className="text-[11px] text-muted">{e.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Fix-a-detail modal: mark the wrong area + say what it should be → only that spot is edited. */}
      {refineGen && (
        <RefineModal
          gen={refineGen}
          onClose={() => setRefineGen(null)}
          onDone={(g, url) => {
            setResults((x) => ({ ...x, [slot(g.shot_type, g.variant_id ?? undefined)]: url }));
            setRefineGen(null);
            toast("Detail fixed — saved as a new candidate ✓", "success");
            scheduleRefresh();
          }}
          onError={(m) => { setErr(m); toast(m, "error"); }}
        />
      )}

      {/* Right guide rail */}
      <aside className="space-y-4">
        <div className="bg-white rounded-2xl border border-sand p-4 shadow-card">
          <p className="text-sm font-medium text-ink mb-2">How to get best results</p>
          <ul className="text-xs text-muted space-y-1.5">
            <li>📷 Use clean, high-resolution raw shots</li>
            <li>💡 Good lighting, neutral background</li>
            <li>💍 Show full piece, not extreme close-up</li>
            <li>✦ Avoid props — let the jewellery shine</li>
            <li>🎯 Choose the right angle &amp; model</li>
          </ul>
        </div>
        <div className="bg-white rounded-2xl border border-sand p-4 shadow-card">
          <p className="text-sm font-medium text-ink mb-2">Jewellery Photography Guide</p>
          <p className="text-[11px] font-medium text-ink mt-2">Best lighting</p>
          <ul className="text-xs text-muted space-y-1 mt-1">
            <li>• Soft studio light (recommended)</li>
            <li>• Diffused light for kundan &amp; polki</li>
            <li>• Top light for diamonds</li>
            <li>• Warm light for gold</li>
          </ul>
          <p className="text-[11px] font-medium text-ink mt-3">Best models</p>
          <ul className="text-xs text-muted space-y-1 mt-1">
            <li>• Indian model for traditional pieces</li>
            <li>• Neutral makeup, hair tied or sleek</li>
            <li>• Elegant &amp; minimal styling</li>
          </ul>
          <p className="text-[11px] font-medium text-ink mt-3">What converts best</p>
          <ul className="text-xs text-muted space-y-1 mt-1">
            <li>✓ Clear full view of the piece</li>
            <li>✓ Close-up for details</li>
            <li>✓ On-model for feel &amp; size</li>
            <li>✓ Lifestyle for storytelling</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

function StatusBtn({ id, status, title }: { id: string; status: string; title: string }) {
  return (
    <form action={setGenerationStatusAction} className="flex-1">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <button className="w-full text-[10px] rounded bg-ink/5 hover:bg-ink/10 leading-none py-0.5" title={status}>{title}</button>
    </form>
  );
}

/** Permanently delete this generated candidate (file + row). Publishing already copies live photos
 *  to the storefront, so deleting a candidate never removes a published image. */
function DeleteGenBtn({ id }: { id: string }) {
  return (
    <form action={deleteGenerationAction} className="flex-1" onSubmit={(e) => { if (!confirm("Delete this generated image permanently?")) e.preventDefault(); }}>
      <input type="hidden" name="id" value={id} />
      <button className="w-full text-[10px] rounded bg-rose/10 text-rose hover:bg-rose/20 leading-none py-0.5" title="Delete permanently">🗑</button>
    </form>
  );
}

/**
 * RefineModal — the "Fix a detail" workflow (the client's ChatGPT-style mark-and-comment).
 * The owner drags a box over the wrong area of a generated shot and types what it should be.
 * We draw that box onto the image (so the AI knows exactly WHERE), send it plus the correction
 * to refineGenerationAction (which also re-feeds the original raw photo as the true design), and
 * get back a surgically-edited image saved as a NEW candidate.
 */
function RefineModal({
  gen, onClose, onDone, onError,
}: {
  gen: Gen;
  onClose: () => void;
  onDone: (gen: Gen, url: string) => void;
  onError: (msg: string) => void;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [disp, setDisp] = useState<{ w: number; h: number } | null>(null);
  const [instruction, setInstruction] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Drag rectangle in DISPLAY pixels (relative to the image box).
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const drawing = useRef(false);

  function onImgLoad() {
    const im = imgRef.current; if (!im) return;
    const natW = im.naturalWidth || 1, natH = im.naturalHeight || 1;
    const maxW = 460, maxH = 520;
    let w = Math.min(maxW, natW), h = (w * natH) / natW;
    if (h > maxH) { h = maxH; w = (h * natW) / natH; }
    setDisp({ w: Math.round(w), h: Math.round(h) });
  }

  function pos(e: React.PointerEvent) {
    const r = wrapRef.current!.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
    const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
    return { x, y };
  }
  function down(e: React.PointerEvent) {
    e.preventDefault();
    const p = pos(e); drawing.current = true; setStart(p); setRect({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current || !start) return;
    const p = pos(e);
    setRect({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) });
  }
  function up() { drawing.current = false; }

  async function submit() {
    const text = instruction.trim();
    if (!text) { onError("Type what should change first."); return; }
    setSubmitting(true);
    try {
      let markedBase64: string | undefined;
      let markedMime: string | undefined;
      let region: { x: number; y: number; w: number; h: number } | null = null;
      const im = imgRef.current;
      const hasBox = !!(rect && rect.w > 6 && rect.h > 6 && disp);
      if (hasBox && im) {
        const natW = im.naturalWidth, natH = im.naturalHeight;
        const sx = natW / disp!.w, sy = natH / disp!.h;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = natW; canvas.height = natH;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(im, 0, 0, natW, natH);
          ctx.strokeStyle = "rgba(40,220,90,0.95)";
          ctx.lineWidth = Math.max(4, Math.round(natW * 0.006));
          ctx.strokeRect(rect!.x * sx, rect!.y * sy, rect!.w * sx, rect!.h * sy);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
          markedBase64 = dataUrl.split(",")[1];
          markedMime = "image/jpeg";
        } catch {
          // Cross-origin taint — proceed without the marker; the text instruction still guides the edit.
          markedBase64 = undefined;
        }
        region = { x: rect!.x / disp!.w, y: rect!.y / disp!.h, w: rect!.w / disp!.w, h: rect!.h / disp!.h };
      }
      const r = await refineGenerationAction({ generationId: gen.id, instruction: text, markedBase64, markedMime, region });
      if (r.ok && r.url) onDone(gen, r.url);
      else onError(reasonText(r.reason, r.error));
    } catch {
      onError("Network error — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="font-display text-xl text-ink">Fix a detail</p>
            <p className="text-xs text-muted">Drag a box over the wrong area, then say what it should be. Only that spot changes — everything else stays exactly the same.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink text-lg leading-none">✕</button>
        </div>

        <div className="my-3 grid place-items-center">
          <div
            ref={wrapRef}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
            className="relative rounded-xl overflow-hidden border border-sand cursor-crosshair touch-none select-none"
            style={disp ? { width: disp.w, height: disp.h } : undefined}
          >
            {/* crossOrigin anonymous so we can composite the marker onto a canvas (same as branding). */}
            <img
              ref={imgRef} src={gen.output_path ?? ""} alt="candidate" crossOrigin="anonymous"
              onLoad={onImgLoad} className="block w-full h-full object-contain bg-cream" draggable={false}
            />
            {rect && rect.w > 1 && rect.h > 1 && (
              <div className="absolute border-2 border-emerald bg-emerald/10 pointer-events-none"
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} />
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-[11px] text-muted">
            <span>{rect && rect.w > 6 ? "✓ Area marked" : "Tip: drag to mark the exact spot"}</span>
            {rect && <button onClick={() => { setRect(null); setStart(null); }} className="text-emerald nav-link">clear box</button>}
          </div>
        </div>

        <label className="block text-xs font-medium text-muted mb-1">What should it look like?</label>
        <textarea
          value={instruction} onChange={(e) => setInstruction(e.target.value)} rows={3}
          placeholder='e.g. "the bottom heart pendant should be a small open outline heart, same as the reference photo — not a solid circle"'
          className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald"
        />
        <p className="text-[11px] text-muted mt-1">The AI also re-checks your original raw photo for the true design, so the fix matches the real piece.</p>

        <div className="flex items-center gap-2 mt-4">
          <button onClick={submit} disabled={submitting || !instruction.trim()}
            className="px-4 py-2 rounded-xl bg-ink text-white text-sm disabled:opacity-50">
            {submitting ? "Fixing…" : "✏️ Apply fix"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Cancel</button>
          <span className="ml-auto text-[11px] text-muted">Saved as a new candidate — your current image is kept.</span>
        </div>
      </div>
    </div>
  );
}
