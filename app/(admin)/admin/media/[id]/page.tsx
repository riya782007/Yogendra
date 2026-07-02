export const dynamic = "force-dynamic";
// AI image generation (Gemini/OpenAI) routinely takes 15–40s; without this the Vercel function is
// killed at the default 10s and the "Generate/＋Model/＋Stand" click dies silently with no image.
export const maxDuration = 60;
import { notFound, redirect } from "next/navigation";
import { getStudioData } from "@/lib/supabase/queries";
import { geminiConfigured } from "@/lib/ai/gemini";
import { requirePerm } from "@/lib/auth";
import { PhotoStudio } from "@/components/admin/PhotoStudio";

export const metadata = { title: "Owner Console · Product Photos" };

export default async function StudioPage({ params }: { params: { id: string } }) {
  if (!(await requirePerm("catalog.ai")) && !(await requirePerm("catalog.view"))) redirect("/admin/dashboard?denied=photos");
  const data = await getStudioData(params.id);
  if (!data) notFound();
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <PhotoStudio data={data as any} ready={geminiConfigured()} />
    </main>
  );
}
