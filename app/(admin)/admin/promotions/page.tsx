export const dynamic = "force-dynamic";
// Poster generation (Gemini/OpenAI) can take 15–40s — raise the function timeout so it never dies at 10s.
export const maxDuration = 60;
import { redirect } from "next/navigation";
import { getCategories, getPromotionsAdmin } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";
import { openaiConfigured, geminiTextConfigured } from "@/lib/ai/providers";
import { geminiConfigured } from "@/lib/ai/gemini";
import { PromotionsClient } from "@/components/admin/PromotionsClient";
import { PromoUpload } from "@/components/admin/PromoUpload";

export const metadata = { title: "Owner Console · Promotions" };

export default async function PromotionsPage() {
  if (!(await requirePerm("marketing.manage"))) redirect("/admin/dashboard?denied=promotions");
  const [cats, promos] = await Promise.all([getCategories(), getPromotionsAdmin()]);
  const categories = ((cats as any[]) ?? []).map((c) => ({ name: c.name, slug: c.slug }));
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Promotions</h1>
      <p className="text-sm text-muted mb-5">Upload your own banner (image or video) and publish it to your storefront or wholesale panel — or generate a festive poster with AI below.</p>

      {/* Owner's manual banner manager — upload a creative + details, publish anywhere. */}
      <PromoUpload categories={categories} />

      <p className="text-sm font-medium text-gold-dark mb-3">…or generate a poster with AI, and manage your live campaigns below</p>
      <PromotionsClient categories={categories} promos={promos as any} ready={{ openai: openaiConfigured() || geminiTextConfigured(), gemini: geminiConfigured() }} />
    </main>
  );
}
