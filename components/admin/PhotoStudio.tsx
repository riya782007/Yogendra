"use client";
/**
 * PhotoStudio — the AI Jewellery Photography Studio (mockup-faithful, fully wired).
 * Upload a raw shot → AI inspects it → generate a professional hero + angles → regenerate with
 * art-direction settings (never overwrites) → Accept / Reject / Compare / Publish.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  generateStudioImageAction, setGenerationStatusAction, publishGenerationAction, detectJewelleryAction,
} from "@/app/actions/studio";

type Gen = { id: string; output_path: string | null; shot_type: string; version: number; status: string; provider: string | null; settings: any; created_at: string };
type Data = {
  product: { id: string; sku: string; name: string; category?: { name?: string } };
  raw: { id: string; path: string } | null;
  images: { id: string; path: string; sort: number }[];
  generations: Gen[];
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
  const p = data.product;
  const [pending, start] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [more, setMore] = useState(false);

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

  function gen(shotType: string, key: string) {
    if (!ready) { setErr("Add GEMINI_API_KEY or OPENAI_API_KEY to enable generation."); return; }
    if (!data.raw && data.images.length === 0) { setErr("Upload a raw photo first (Manage media)."); return; }
    setErr(""); setBusyKey(key);
    start(async () => {
      const r = await generateStudioImageAction({ productId: p.id, shotType: shotType as any, settings: settings(), style: styleParam });
      setBusyKey(null);
      if (!r.ok) setErr(r.error || r.reason || "Generation failed."); else router.refresh();
    });
  }

  function redetect() {
    setBusyKey("detect");
    start(async () => { await detectJewelleryAction(p.id); setBusyKey(null); router.refresh(); });
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

        {/* Main studio card */}
        <div className="bg-white rounded-2xl border border-sand shadow-card p-5">
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
                {pending && busyKey === "hero" && <div className="absolute inset-0 bg-ink/40 grid place-items-center text-cream text-sm">Generating…</div>}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                {heroUrl && <a href={heroUrl} target="_blank" className="px-2 py-1 rounded-lg bg-ink/5 hover:bg-ink/10">View</a>}
                {heroUrl && <a href={heroUrl} download className="px-2 py-1 rounded-lg bg-ink/5 hover:bg-ink/10">⬇ Download</a>}
                <button onClick={() => gen("hero", "hero")} disabled={pending} className="px-2 py-1 rounded-lg bg-gold/15 text-gold-dark hover:bg-gold/25">⟳ Regenerate</button>
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
              <button onClick={() => gen("hero", "hero")} disabled={pending} className="w-full mt-2 px-3 py-2 rounded-xl bg-ink text-white text-sm disabled:opacity-50">✦ Regenerate image</button>
            </div>
          </div>

          {/* Additional angles */}
          <div className="mt-6">
            <p className="text-sm font-medium text-ink mb-2">Additional angles</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {ANGLES.map((a) => {
                const cand = candidatesOf(a.key);
                const top = cand.find((g) => g.status === "published") ?? cand[0];
                return (
                  <div key={a.key}>
                    <div className="aspect-[4/5] rounded-lg bg-cream border border-sand overflow-hidden relative">
                      {top?.output_path ? <img src={top.output_path} alt={a.label} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-[9px] text-muted text-center">{a.label}</div>}
                      {pending && busyKey === a.key && <div className="absolute inset-0 bg-ink/40 grid place-items-center text-cream text-[10px]">…</div>}
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <button onClick={() => gen(a.key, a.key)} disabled={pending} className="text-[10px] text-gold-dark hover:underline">⟳ {cand.length ? "Regen" : "Make"}</button>
                      {top && top.status !== "published" && <form action={publishGenerationAction}><input type="hidden" name="id" value={top.id} /><button className="text-[10px] text-emerald">Pub</button></form>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* AI enhancement options */}
          <div className="mt-6">
            <p className="text-sm font-medium text-ink mb-2">AI enhancement options</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ENHANCERS.map((e) => (
                <button key={e.key} onClick={() => gen(e.key, e.key)} disabled={pending}
                  className="text-left rounded-xl border border-sand bg-white p-3 hover:border-emerald disabled:opacity-50">
                  <p className="text-sm text-ink">{busyKey === e.key && pending ? "Generating…" : e.label}</p>
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
