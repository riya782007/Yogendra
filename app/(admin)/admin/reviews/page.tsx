export const dynamic = "force-dynamic";
import { getReviewsForResponse } from "@/lib/supabase/queries";
import { ReviewResponder } from "@/components/admin/ReviewResponder";
import { addFeaturedReviewAction } from "@/app/actions/reviews";

export const metadata = { title: "Owner Console · Reviews" };

export default async function Reviews() {
  const reviews = await getReviewsForResponse();
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald w-full";
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-3xl">
      <h1 className="font-display text-4xl text-ink mb-1">Reviews &amp; Reputation</h1>
      <p className="text-sm text-muted mb-6">Reply to customers in your brand voice — the AI drafts it, you approve. Responding lifts trust and local search ranking.</p>

      {/* Add a homepage photo review — appears in the storefront "Happy Divas" section (photos first). */}
      <section className="bg-white rounded-2xl p-5 shadow-card mb-6 border border-sand">
        <h2 className="font-medium text-ink mb-1">Add a homepage review (with photo)</h2>
        <p className="text-xs text-muted mb-3">Shows in the &ldquo;Happy Divas&rdquo; section on the storefront. Paste an image link (a customer photo or a styled shot) — reviews with a photo are shown first.</p>
        <form action={addFeaturedReviewAction} className="grid sm:grid-cols-2 gap-3">
          <input name="author_name" placeholder="Customer name *" required className={fld} />
          <select name="rating" defaultValue="5" className={fld}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} ★</option>)}</select>
          <textarea name="body" placeholder="Review text *" required rows={2} className={`${fld} sm:col-span-2`} />
          <input name="image_url" placeholder="Image URL (optional — customer / styled photo)" className={`${fld} sm:col-span-2`} />
          <button className="btn-primary px-5 py-2.5 text-sm font-medium sm:col-span-2 justify-self-start">+ Add review</button>
        </form>
      </section>

      <ReviewResponder reviews={reviews as any} />
    </main>
  );
}
