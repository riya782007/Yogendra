"use client";
/**
 * Promotions studio — the owner types a rough festive idea, ChatGPT refines it into a poster prompt,
 * Gemini (Nano Banana) renders a high-quality poster, and the retail / wholesale toggles push it to
 * the storefront hero (targeted to the most-suited category).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import {
  refinePromoAction, generatePromoAction, publishPromoAction, setPromoStatusAction, deletePromoAction,
} from "@/app/actions/promotions";

type Cat = { name: string; slug: string };
type Promo = {
  id: string; title: string | null; image_path: string | null; refined_prompt: string | null; prompt: string | null;
  status: string; show_retail: boolean; show_wholesale: boolean; aspect: string | null;
  category?: { slug?: string; name?: string } | null;
};

const field = "w-full rounded-xl border border-sand bg-white px-3.5 py-2.5 text-sm outline-none focus:border-emerald transition";
const ASPECTS = [["16:9", "Wide banner (16:9)"], ["1:1", "Square (1:1)"], ["4:5", "Portrait (4:5)"]] as const;

export function PromotionsClient({ categories, promos, ready }: { categories: Cat[]; promos: Promo[]; ready: { openai: boolean; gemini: boolean } }) {
  const router = useRouter();
  const { toast } = useToast();

  const [idea, setIdea] = useState("");
  const [title, setTitle] = useState("");
  const [refined, setRefined] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [aspect, setAspect] = useState<string>("16:9");
  const [refining, setRefining] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [promotionId, setPromotionId] = useState<string | undefined>(undefined);
  const [showRetail, setShowRetail] = useState(true);
  const [showWholesale, setShowWholesale] = useState(false);

  async function refine() {
    if (!idea.trim()) { toast("Type your promotion idea first", "error"); return; }
    setRefining(true);
    const r = await refinePromoAction({ idea });
    setRefining(false);
    if (r.ok) {
      setTitle(r.title ?? "Festive Campaign");
      setRefined(r.refinedPrompt ?? "");
      if (r.categorySlug && categories.some((c) => c.slug === r.categorySlug)) setCategorySlug(r.categorySlug);
      toast("Prompt refined by ChatGPT ✨ — review, then generate", "success");
    } else toast(r.error ?? "Couldn't refine", "error");
  }

  async function generate() {
    const prompt = refined.trim();
    if (!prompt) { toast("Refine or write a prompt first", "error"); return; }
    setGenerating(true); setPreviewUrl(null);
    const r = await generatePromoAction({ refinedPrompt: prompt, title, idea, categorySlug: categorySlug || null, aspect, promotionId });
    setGenerating(false);
    if (r.ok && r.url) { setPreviewUrl(r.url); setPromotionId(r.id); toast("Poster generated ✓ — set toggles & publish", "success"); router.refresh(); }
    else toast(r.error ?? "Couldn't generate the poster", "error");
  }

  async function publish() {
    if (!promotionId) { toast("Generate a poster first", "error"); return; }
    if (!showRetail && !showWholesale) { toast("Turn on Storefront and/or Wholesale first", "error"); return; }
    setPublishing(true);
    const r = await publishPromoAction({ id: promotionId, showRetail, showWholesale, categorySlug: categorySlug || null });
    setPublishing(false);
    if (r.ok) {
      toast(`Published ✓ — live on ${[showRetail && "storefront", showWholesale && "wholesale"].filter(Boolean).join(" & ")} hero`, "success");
      router.refresh();
    } else toast(r.error ?? "Couldn't publish", "error");
  }

  async function toggleScope(p: Promo, which: "retail" | "wholesale", on: boolean) {
    const showR = which === "retail" ? on : p.show_retail;
    const showW = which === "wholesale" ? on : p.show_wholesale;
    const r = await publishPromoAction({ id: p.id, showRetail: showR, showWholesale: showW, categorySlug: p.category?.slug ?? null });
    if (r.ok) { toast("Updated ✓", "success"); router.refresh(); } else toast(r.error ?? "Couldn't update", "error");
  }

  return (
    <div className="space-y-6">
      {!ready.openai && <div className="rounded-xl bg-gold/15 text-gold-dark px-4 py-2 text-sm">Add <b>OPENAI_API_KEY</b> to refine prompts with ChatGPT.</div>}
      {!ready.gemini && <div className="rounded-xl bg-gold/15 text-gold-dark px-4 py-2 text-sm">Add <b>GEMINI_API_KEY</b> (or OpenAI) to generate posters.</div>}

      {/* ===== Studio ===== */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Left: prompt + controls */}
        <section className="bg-white rounded-2xl border border-sand shadow-card p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Your idea <span className="text-muted/70">— rough is fine, ChatGPT will refine it</span></label>
            <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={3} className={field}
              placeholder="e.g. Diwali sale, flat 30% off on kundan necklaces, festive vibe" />
            <button onClick={refine} disabled={refining || !ready.openai} className="mt-2 px-4 py-2 rounded-xl bg-emerald text-white text-sm disabled:opacity-50">
              {refining ? "Refining…" : "✨ Refine with ChatGPT"}
            </button>
          </div>

          {(refined || title) && (
            <>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Campaign title</label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Refined poster prompt <span className="text-muted/70">— edit freely</span></label>
                <textarea value={refined} onChange={(e) => setRefined(e.target.value)} rows={7} className={`${field} text-[13px] leading-relaxed`} />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Best-suited section</label>
              <select value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={field}>
                <option value="">Whole shop (home hero)</option>
                {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted mb-1">Shape</label>
              <select value={aspect} onChange={(e) => setAspect(e.target.value)} className={field}>
                {ASPECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <button onClick={generate} disabled={generating || !refined.trim() || !ready.gemini} className="w-full px-4 py-2.5 rounded-xl bg-ink text-white text-sm disabled:opacity-50">
            {generating ? "Generating poster… (15–40s)" : "🎨 Generate poster with Gemini"}
          </button>
        </section>

        {/* Right: preview + publish */}
        <section className="bg-white rounded-2xl border border-sand shadow-card p-5">
          <p className="text-sm font-medium text-ink mb-2">Preview</p>
          <div className="rounded-xl bg-cream border border-sand overflow-hidden grid place-items-center min-h-[220px]">
            {previewUrl ? <img src={previewUrl} alt="poster" className="w-full h-auto" />
              : <span className="text-xs text-muted p-6 text-center">Your generated poster appears here. Refine an idea → generate → then choose where to publish.</span>}
            {generating && <span className="text-xs text-muted p-4">Generating…</span>}
          </div>

          {previewUrl && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted">Choose where this poster goes live. The system places it in the hero of the selected section.</p>
              <label className="flex items-center justify-between rounded-xl border border-sand px-3 py-2.5">
                <span className="text-sm text-ink">🛍 Publish on storefront (retail)</span>
                <input type="checkbox" checked={showRetail} onChange={(e) => setShowRetail(e.target.checked)} className="accent-emerald w-4 h-4" />
              </label>
              <label className="flex items-center justify-between rounded-xl border border-sand px-3 py-2.5">
                <span className="text-sm text-ink">📦 Publish on wholesale panel</span>
                <input type="checkbox" checked={showWholesale} onChange={(e) => setShowWholesale(e.target.checked)} className="accent-emerald w-4 h-4" />
              </label>
              <div className="flex items-center gap-2">
                <button onClick={publish} disabled={publishing} className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50">{publishing ? "Publishing…" : "Publish poster"}</button>
                <button onClick={generate} disabled={generating} className="px-4 py-2.5 rounded-xl bg-gold/15 text-gold-dark text-sm disabled:opacity-50">⟳ Regenerate</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ===== Existing campaigns ===== */}
      <section>
        <p className="text-sm font-medium text-ink mb-2">Your campaigns</p>
        {promos.length === 0 ? (
          <p className="text-sm text-muted">No campaigns yet — create your first above.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {promos.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl border border-sand shadow-card overflow-hidden">
                <div className="aspect-[16/9] bg-cream overflow-hidden">
                  {p.image_path ? <img src={p.image_path} alt={p.title ?? "poster"} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-xs text-muted">No image</div>}
                </div>
                <div className="p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-ink truncate">{p.title ?? "Untitled"}</p>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${p.status === "published" ? "bg-emerald-mist text-emerald-dark" : p.status === "archived" ? "bg-sand/60 text-muted" : "bg-gold/15 text-gold-dark"}`}>{p.status}</span>
                  </div>
                  <p className="text-[11px] text-muted mt-0.5">{p.category?.name ? `Section: ${p.category.name}` : "Whole shop"}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
                    <button onClick={() => toggleScope(p, "retail", !p.show_retail)} className={`px-2 py-1 rounded-full border ${p.show_retail ? "bg-emerald text-white border-emerald" : "border-sand text-muted hover:border-emerald"}`}>🛍 Retail</button>
                    <button onClick={() => toggleScope(p, "wholesale", !p.show_wholesale)} className={`px-2 py-1 rounded-full border ${p.show_wholesale ? "bg-emerald text-white border-emerald" : "border-sand text-muted hover:border-emerald"}`}>📦 Wholesale</button>
                    <a href={p.image_path ?? "#"} target="_blank" className="px-2 py-1 rounded-full bg-ink/5 hover:bg-ink/10">View</a>
                    <form action={setPromoStatusAction} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="status" value={p.status === "archived" ? "draft" : "archived"} />
                      <button className="px-2 py-1 rounded-full bg-ink/5 hover:bg-ink/10">{p.status === "archived" ? "Restore" : "Archive"}</button>
                    </form>
                    <form action={deletePromoAction} className="inline">
                      <input type="hidden" name="id" value={p.id} />
                      <button className="px-2 py-1 rounded-full text-rose hover:bg-rose/10">Delete</button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
