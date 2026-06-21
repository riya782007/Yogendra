export const dynamic = "force-dynamic";
import { getReviewsForResponse } from "@/lib/supabase/queries";
import { ReviewResponder } from "@/components/admin/ReviewResponder";

export const metadata = { title: "Owner Console · Reviews" };

export default async function Reviews() {
  const reviews = await getReviewsForResponse();
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-3xl">
      <h1 className="font-display text-4xl text-ink mb-1">Reviews &amp; Reputation</h1>
      <p className="text-sm text-muted mb-6">Reply to customers in your brand voice — the AI drafts it, you approve. Responding lifts trust and local search ranking.</p>
      <ReviewResponder reviews={reviews as any} />
    </main>
  );
}
