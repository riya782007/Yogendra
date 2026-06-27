export const dynamic = "force-dynamic";
import { getProductSubmissions, getCategories } from "@/lib/supabase/queries";
import { SubmissionRow } from "@/components/admin/SubmissionRow";

const money = (paise?: number | null) => "₹" + ((Number(paise) || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export default async function Submissions() {
  const [subs, categories] = await Promise.all([getProductSubmissions(), getCategories()]);
  const cats = categories.map((c) => ({ id: c.id, name: c.name }));
  const pending = subs.filter((s) => s.status === "pending");
  const decided = subs.filter((s) => s.status !== "pending");

  return (
    <main className="p-6 sm:p-8 max-w-4xl">
      <h1 className="font-serif text-3xl text-diva-ink mb-1">Product Submissions</h1>
      <p className="text-sm text-diva-ink/60 mb-6">
        Products sent in by customers and wholesalers. Approving one creates a <strong>draft</strong> product in your
        catalogue (with the photo) — review the price, then publish it from the Catalogue.
      </p>

      <section className="mb-10">
        <h2 className="text-xs uppercase tracking-widest text-diva-ink/50 mb-3">Pending review · {pending.length}</h2>
        <div className="space-y-4">
          {pending.length === 0 && <p className="text-sm text-diva-ink/50">No submissions waiting. New ones appear here automatically.</p>}
          {pending.map((s) => (
            <SubmissionRow key={s.id} sub={s as any} categories={cats} money={money(s.asking_price)} />
          ))}
        </div>
      </section>

      {decided.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-widest text-diva-ink/50 mb-3">Reviewed · {decided.length}</h2>
          <div className="space-y-3">
            {decided.map((s) => (
              <div key={s.id} className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4">
                {s.image_path ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.image_path} alt={s.product_name} className="w-14 h-14 rounded-lg object-cover bg-diva-cream shrink-0" />
                ) : (
                  <div className="w-14 h-14 rounded-lg bg-diva-cream grid place-items-center text-diva-ink/30 shrink-0">◇</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-diva-ink truncate">{s.product_name}</p>
                  <p className="text-xs text-diva-ink/50">
                    {s.channel} · {s.submitter_name || "—"} · {money(s.asking_price)}
                    {s.created_product_sku ? ` · → ${s.created_product_sku}` : ""}
                  </p>
                  {s.review_note && <p className="text-xs text-diva-ink/40 mt-0.5 italic">“{s.review_note}”</p>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs shrink-0 ${s.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
