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
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  generateStudioImageAction, setGenerationStatusAction, publishGenerationAction, detectJewelleryAction,
  uploadBrandedImageAction,
} from "@/app/actions/studio";
import { addVariantImageAction } from "@/app/actions/variants";

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

type Gen = { id: string; output_path: string | null; shot_type: string; version: number; status: string; provider: string | null; settings: any; created_at: string; variant_id?: string | null };
type Data = {
  product: { id: string; sku: string; name: string; category?: { name?: string } };
  raw: { id: string; path: string } | null;
  images: { id: string; path: string; sort: number }[];
  generations: Gen[];
  variants?: { id: string; sku: string; color: string | null; image: string | null }[];
  detected: { category?: string; material?: string; style?: string; attributes?: string[] } | null;
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

  const isBusy = (key: string) => busy.has(key);
  const anyBusy = busy.size > 0;
  const addBusy = (key: string) => setBusy((b) => { const n = new Set(b); n.add(key); return n; });
  const dropBusy = (key: string) => setBusy((b) => { const n = new Set(b); n.delete(key); return n; });

  // Art-direction settings.
  const [lighting, setLighting] = useState(LIGHTING[0]);
  const [modelStyle, setModelStyle] = useState(MODEL_STYLE[0]);
  const [background, setBackground] = useState(BACKGROUND[0]);
  const [focus, setFocus] = useState(FOCUS[0]);
  const [ethnicity, setEthnicity] = useState("");
  const [pose, setPose] = useState("");
  const [makeup, setMakeup] = useState("");
  const [mood, setMood] = useState("");

  const styleParam: "auto" | "indian" | "western" = modelStyle.startsWith("Western") ? "western" : modelStyle.startsWith("Indian") ? "indian" : "auto";
  const settings = () => ({ lighting, modelStyle, background, focus, ethnicity, pose, makeup, mood, emphasis: focus });

  const candidatesOf = (shot: string) => data.generations.filter((g) => g.shot_type === shot && g.output_path && g.status !== "rejected" && g.status !== "archived");
  const heroCandidates = candidatesOf("hero");
  const hero = heroCandidates.find((g) => g.status === "published") ?? heroCandidates.find((g) => g.status === "favorite") ?? heroCandidates[0] ?? null;
  const heroUrl = hero?.output_path ?? data.images[0]?.path ?? data.raw?.path ?? null;

  const variants = data.variants ?? [];

  /** Fire one generation. Concurrency-safe: adds its own key to `busy`, so other buttons stay live
   *  and the operator can queue several at once. Returns true on success (used by "Generate all"). */
  async function gen(shotType: string, key: string, variantId?: string): Promise<boolean> {
    if (!ready) { const m = REASON_MSG.no_key; setErr(m); toast(m, "error"); return false; }
    if (!data.raw && data.images.length === 0 && !variants.some((v) => v.image)) { const m = REASON_MSG.no_source; setErr(m); toast(m, "error"); return false; }
    if (isBusy(key)) return false; // already running this exact shot
    setErr(""); addBusy(key);
    try {
      const r = await generateStudioImageAction({ productId: p.id, shotType: shotType as any, settings: settings(), style: styleParam, variantId });
      if (!r.ok) { const m = reasonText(r.reason, r.error); setErr(m); toast(m, "error"); return false; }
      toast("Image generated ✓", "success"); router.refresh(); return true;
    } catch {
      const m = "Network error — try again."; setErr(m); toast(m, "error"); return false;
    } finally {
      dropBusy(key);
    }
  }

  /** Bulk: enqueue a shot for EVERY variant at once (all run in parallel). */
  async function genAllVariants(shotType: "model" | "branded_stand") {
    if (!ready) { const m = REASON_MSG.no_key; setErr(m); toast(m, "error"); return; }
    if (!variants.length) return;
    toast(`Queued ${variants.length} ${shotType === "model" ? "model" : "stand"} shots — they'll fill in as they finish`, "info");
    await Promise.all(variants.map((v) => gen(shotType, `${shotType === "model" ? "vm" : "vs"}-${v.id}`, v.id)));
    toast("Bulk generation finished ✓", "success");
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

  /** Draw the "blythediva" wordmark onto a generated stand shot (client canvas), then publish it. */
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
      const w = canvas.width, h = canvas.height;
      ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(20,18,16,0.92)";
      ctx.font = `600 ${Math.round(w * 0.055)}px Georgia, 'Times New Roman', serif`;
      ctx.fillText("blythediva", w / 2, h - Math.round(h * 0.045));
      ctx.fillStyle = "rgba(160,130,60,0.9)";
      ctx.font = `${Math.round(w * 0.02)}px Georgia, serif`;
      ctx.fillText("A R T I F I C I A L   J E W E L L E R Y", w / 2, h - Math.round(h * 0.02));
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Regenerate settings */}
            <div>
              <p className="text-[11px] font-medium text-ink mb-1.5">Regenerate settings</p>
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

          {/* Additional angles */}
          <div id="studio-angles" className="scroll-mt-16 mt-6">
            <p className="text-sm font-medium text-ink mb-2">Additional angles</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {ANGLES.map((a) => {
                const cand = candidatesOf(a.key);
                const top = cand.find((g) => g.status === "published") ?? cand[0];
                return (
                  <div key={a.key}>
                    <div className="aspect-[4/5] rounded-lg bg-cream border border-sand overflow-hidden relative">
                      {top?.output_path ? <img src={top.output_path} alt={a.label} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[9px] text-muted text-center">{a.label}</div>}
                      {isBusy(a.key) && <div className="absolute inset-0 bg-ink/40 grid place-items-center text-cream text-[10px]">…</div>}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <button onClick={() => gen(a.key, a.key)} disabled={isBusy(a.key)} className="text-[10px] text-gold-dark hover:underline disabled:opacity-50">{isBusy(a.key) ? "…" : (cand.length ? "⟳ Regen" : "Make")}</button>
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
                  return (
                    <div key={v.id} className="flex items-center gap-3 rounded-xl border border-sand p-2.5">
                      <div className="w-10 h-12 rounded-lg overflow-hidden bg-cream shrink-0 relative">
                        {v.image ? <img src={v.image} alt={v.color ?? v.sku} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[8px] text-muted text-center">no raw</div>}
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
                        {vModel?.output_path
                          ? <img src={vModel.output_path} alt="model" className="w-10 h-12 rounded object-cover inline-block" />
                          : <div className="w-10 h-12 rounded bg-cream inline-grid place-items-center text-[9px] text-muted">model</div>}
                        <button onClick={() => gen("model", `vm-${v.id}`, v.id)} disabled={isBusy(`vm-${v.id}`)} className="block text-[10px] text-gold-dark hover:underline mt-0.5 w-full disabled:opacity-50">{isBusy(`vm-${v.id}`) ? "…" : (vModel ? "⟳ Model" : "＋ Model")}</button>
                      </div>
                      {/* Branded stand */}
                      <div className="text-center">
                        {vStand?.output_path
                          ? <img src={vStand.output_path} alt="stand" className="w-10 h-12 rounded object-cover inline-block" />
                          : <div className="w-10 h-12 rounded bg-cream inline-grid place-items-center text-[9px] text-muted">stand</div>}
                        <button onClick={() => gen("branded_stand", `vs-${v.id}`, v.id)} disabled={isBusy(`vs-${v.id}`)} className="block text-[10px] text-gold-dark hover:underline mt-0.5 w-full disabled:opacity-50">{isBusy(`vs-${v.id}`) ? "…" : (vStand ? "⟳ Stand" : "＋ Stand")}</button>
                      </div>
                      {vStand?.output_path && vStand.status !== "published" && (
                        <button onClick={() => brandAndPublish(vStand.output_path!, v.id, `br-${v.id}`)} disabled={isBusy(`br-${v.id}`)} className="ml-auto px-2.5 py-1.5 rounded-lg bg-emerald text-white text-[11px] disabled:opacity-50">
                          {isBusy(`br-${v.id}`) ? "Branding…" : "Brand & Publish"}
                        </button>
                      )}
                      {vStand?.status === "published" && <span className="ml-auto text-[11px] text-emerald-dark">✓ Branded</span>}
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
