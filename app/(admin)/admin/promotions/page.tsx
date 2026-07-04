export const dynamic = "force-dynamic";
// Poster generation (Gemini/OpenAI) can take 15–40s — raise the function timeout so it never dies at 10s.
export const maxDuration = 60;
import { redirect } from "next/navigation";
import { getCategories, getPromotionsAdmin } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";
import { openaiConfigured } from "@/lib/ai/providers";
import { geminiConfigured } from "@/lib/ai/gemini";
import { PromotionsClient } from "@/components/admin/PromotionsClient";

export const metadata = { title: "Owner Console · Promotions" };

export default async function PromotionsPage() {
  if (!(await requirePerm("marketing.manage"))) redirect("/admin/dashboard?denied=promotions");
  const [cats, promos] = await Promise.all([getCategories(), getPromotionsAdmin()]);
  const categories = ((cats as any[]) ?? []).map((c) => ({ name: c.name, slug: c.slug }));
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Promotions</h1>
      <p className="text-sm text-muted mb-5">Create festive offer posters with AI and publish them to your storefront. Type a rough idea → ChatGPT refines it → Gemini designs the poster → choose where it goes live, and it lands in the hero of the best-suited section.</p>
      <PromotionsClient categories={categories} promos={promos as any} ready={{ openai: openaiConfigured(), gemini: geminiConfigured() }} />
    </main>
  );
}
