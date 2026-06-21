export const dynamic = "force-dynamic";
import { getProductsWithMedia } from "@/lib/supabase/queries";
import { geminiConfigured } from "@/lib/ai/gemini";
import { MediaCard } from "@/components/admin/MediaCard";

export const metadata = { title: "Owner Console · Product Photos" };

export default async function Media() {
  const products = await getProductsWithMedia();
  const ready = geminiConfigured();
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Product Photos</h1>
      <p className="text-sm text-muted mb-2">Upload the raw design shot → generate a ready-to-publish professional model photo → add angles. The AI reproduces your design exactly.</p>
      <div className={`rounded-xl px-4 py-2.5 mb-5 text-sm ${ready ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark"}`}>
        {ready ? "● Gemini connected — generate professional photos from raw shots." : "○ Gemini not connected — add GEMINI_API_KEY to enable photo generation. You can still upload raw photos now."}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {products.map((p) => <MediaCard key={p.id} p={p as any} geminiReady={ready} />)}
      </div>
    </main>
  );
}
