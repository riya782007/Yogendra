"use client";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { draftReviewReplyAction, saveReviewReplyAction } from "@/app/actions/reputation";

type R = { id: string; author_name: string; rating: number; body: string; response: string | null; product: { name: string } };

export function ReviewResponder({ reviews }: { reviews: R[] }) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(reviews.map((r) => [r.id, r.response ?? ""])));
  const [busy, setBusy] = useState<string>("");

  async function draft(id: string) {
    setBusy(id);
    const res = await draftReviewReplyAction(id);
    setBusy("");
    if (res.ok) { setDrafts((d) => ({ ...d, [id]: res.reply })); toast("AI reply drafted — review and approve"); }
  }
  async function save(id: string) {
    await saveReviewReplyAction(id, drafts[id] ?? "");
    toast("Reply published ✓");
  }

  return (
    <div className="space-y-4">
      {reviews.length === 0 && <p className="text-sm text-muted bg-white rounded-2xl p-5 shadow-card">No reviews yet — customer reviews will appear here for you to respond to.</p>}
      {reviews.map((r) => (
        <div key={r.id} className="bg-white rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-ink">{r.author_name} <span className="text-gold text-sm">{"★".repeat(r.rating)}</span></p>
              <p className="text-xs text-muted">on {r.product?.name}</p>
            </div>
            {r.response && <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-mist text-emerald-dark">replied</span>}
          </div>
          <p className="text-sm text-ink/80 mt-2">“{r.body}”</p>
          <textarea value={drafts[r.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
            placeholder="Your reply…" rows={2} className="w-full mt-3 rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald" />
          <div className="flex gap-2 mt-2">
            <button onClick={() => draft(r.id)} disabled={busy === r.id} className="px-4 py-1.5 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20 disabled:opacity-50">{busy === r.id ? "Drafting…" : "✨ AI draft"}</button>
            <button onClick={() => save(r.id)} className="px-4 py-1.5 rounded-full bg-ink text-white text-xs font-medium">Publish reply</button>
          </div>
        </div>
      ))}
    </div>
  );
}
