export const dynamic = "force-dynamic";
import { getProductsWithMedia } from "@/lib/supabase/queries";
import { geminiConfigured } from "@/lib/ai/gemini";
import { MediaSearchGrid } from "@/components/admin/MediaSearchGrid";

export const metadata = { title: "Owner Console · Product Photos" };

export default async function Media() {
  const products = await getProductsWithMedia();
  const ready = geminiConfigured();
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Product Photos</h1>
      <p className="text-sm text-muted mb-2">Upload the raw design shot → generate a ready-to-publish professional model photo → add angles. The AI reproduces your design exactly.</p>
      <div className={`rounded-xl px-4 py-2.5 mb-5 text-sm ${ready ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>
        {ready ? "● AI photo generation connected — generate professional photos from raw shots (Gemini, with OpenAI fallback)." : "○ Not connected — add GEMINI_API_KEY or OPENAI_API_KEY to enable photo generation. You can still upload raw photos now."}
      </div>
      <p className="text-xs text-muted mb-3">Open a product's <b>AI Studio</b> to generate a hero, angles &amp; enhancements with art-direction controls.</p>
      <MediaSearchGrid products={products as any} ready={ready} />
    </main>
  );
}
