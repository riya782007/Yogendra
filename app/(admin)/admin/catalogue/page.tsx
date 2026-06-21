export const dynamic = "force-dynamic";
import Link from "next/link";
import { getPublishedProducts, getPricingFormula } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { formatPaise } from "@/lib/pricing";
import { geminiConfigured } from "@/lib/ai/gemini";
import { aiProvidersStatus } from "@/lib/ai/listingAgent";
import { ProductImage } from "@/components/Placeholder";
import { generateOneAction, generateAllAction } from "@/app/actions/images";
import { generateContentAction, generateAllContentAction } from "@/app/actions/aiContent";
import { generateEmbeddingsAction } from "@/app/actions/embeddings";

export const metadata = { title: "Owner Console · Catalogue" };

export default async function AdminCatalogue() {
  const [products, formula] = await Promise.all([getPublishedProducts(), getPricingFormula()]);
  const ai = aiProvidersStatus();
  const imageReady = geminiConfigured();

  async function genContent(fd: FormData) { "use server"; await generateContentAction(String(fd.get("sku"))); }
  async function genAllContent() { "use server"; await generateAllContentAction(); }
  async function genPhoto(fd: FormData) { "use server"; await generateOneAction(String(fd.get("sku"))); }
  async function genEmbeddings() { "use server"; await generateEmbeddingsAction(); }

  const Pill = ({ on, label }: { on: boolean; label: string }) => (
    <span className={`text-xs px-2.5 py-1 rounded-full ${on ? "bg-emerald-mist text-emerald-dark" : "bg-cream text-muted"}`}>
      {on ? "●" : "○"} {label}
    </span>
  );

  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="font-display text-4xl text-ink">Catalogue</h1>
          <p className="text-sm text-muted">{products.length} products · AI-drafted pages, one-tap approve</p>
        </div>
        <form action={genAllContent}>
          <button className="btn-primary px-5 py-2.5 text-sm font-medium">✨ Generate all AI pages</button>
        </form>
        <form action={genEmbeddings}><button className="ml-2 px-5 py-2.5 text-sm font-medium rounded-full border border-emerald text-emerald hover:bg-emerald-mist transition-colors">⌖ Build recommendations</button></form>
      </div>

      <div className="flex flex-wrap gap-2 mb-5 items-center">
        <span className="text-xs text-muted mr-1">AI workforce:</span>
        <Pill on={ai.groq} label="Groq (text)" />
        <Pill on={ai.openai} label="OpenAI (fallback)" />
        <Pill on={imageReady} label="Gemini (photos)" />
        {!ai.groq && !ai.openai && <span className="text-xs text-gold-dark">No text model connected — pages fall back to deterministic copy.</span>}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr>
              <th className="p-3">Photo</th><th className="p-3">Product</th><th className="p-3">Category · No.</th>
              <th className="p-3">Price (live)</th><th className="p-3">Page</th><th className="p-3">AI page</th><th className="p-3">AI photo</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const o = liveOffer(p.base_wholesale, formula);
              const hasAi = !!(p.generated_content && (p.generated_content as any).title);
              return (
                <tr key={p.id} className="border-t border-sand/60 hover:bg-cream/40 transition-colors">
                  <td className="p-2"><div className="w-11 h-13 rounded-lg overflow-hidden"><ProductImage name={p.name} /></div></td>
                  <td className="p-3 font-medium text-ink">{p.name}</td>
                  <td className="p-3 text-muted">{p.category.name} · {p.sku}</td>
                  <td className="p-3"><span className="font-semibold">{formatPaise(o.price)}</span>{o.hasOffer && <span className="text-xs text-rose ml-1">{o.offerPct}% off</span>}</td>
                  <td className="p-3"><Link className="text-emerald nav-link" href={`/shop/${p.category.slug}/${p.sku}`}>view ↗</Link></td>
                  <td className="p-3">
                    <form action={genContent} className="flex items-center gap-2">
                      <input type="hidden" name="sku" value={p.sku} />
                      <button className="px-3 py-1.5 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20 transition-colors">{hasAi ? "Regenerate" : "Generate"}</button>
                      {hasAi && <span className="text-[11px] text-emerald-dark">✓ drafted</span>}
                    </form>
                  </td>
                  <td className="p-3">
                    <form action={genPhoto}>
                      <input type="hidden" name="sku" value={p.sku} />
                      <button className="px-3 py-1.5 rounded-full bg-gold/15 text-gold-dark text-xs font-medium hover:bg-gold/25 transition-colors">Photo</button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
