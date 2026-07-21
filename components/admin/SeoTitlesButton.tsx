"use client";
import { useState } from "react";
import { seoTitlePassAction } from "@/app/actions/seoTitles";

type Res = { scanned?: number; rewritten?: number; skipped?: number; sample?: { before: string; after: string }[] };

/** Preview-then-apply SEO title rewrite across the whole catalogue (deterministic, no AI cost). */
export function SeoTitlesButton() {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Res | null>(null);
  const [doneMsg, setDoneMsg] = useState("");

  async function runPreview() {
    setBusy(true); setDoneMsg("");
    const r = await seoTitlePassAction({ dryRun: true });
    setBusy(false);
    if (!r.ok) { alert(r.error ?? "Failed"); return; }
    setPreview(r);
  }
  async function apply() {
    setBusy(true);
    const r = await seoTitlePassAction({ dryRun: false });
    setBusy(false);
    if (!r.ok) { alert(r.error ?? "Failed"); return; }
    setPreview(null);
    setDoneMsg(`✓ Rewrote ${r.rewritten} titles. ${r.skipped} left as-is (codes/one-word names).`);
  }

  return (
    <div className="inline-block">
      <button onClick={runPreview} disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist disabled:opacity-50">
        {busy ? "Working…" : "✨ Improve all titles (SEO)"}
      </button>
      {doneMsg && <span className="ml-3 text-sm text-emerald-dark">{doneMsg}</span>}

      {preview && (
        <div className="fixed inset-0 z-50 bg-ink/50 grid place-items-center p-4" onClick={() => setPreview(null)}>
          <div className="bg-white rounded-2xl shadow-luxe max-w-2xl w-full max-h-[85vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-2xl text-ink">Improve titles — preview</h3>
            <p className="text-sm text-muted mt-1">
              {preview.rewritten} of {preview.scanned} products will get a sharper SEO title.
              {" "}{preview.skipped} are left untouched (SKU-only or one-word names — those stay for the AI/photo flow).
            </p>
            <div className="mt-4 divide-y divide-sand border border-sand rounded-xl overflow-hidden">
              {(preview.sample ?? []).map((s, i) => (
                <div key={i} className="p-3 text-sm">
                  <p className="text-muted line-through">{s.before}</p>
                  <p className="text-ink font-medium">{s.after}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-3 justify-end">
              <button onClick={() => setPreview(null)} className="px-4 py-2 rounded-full border border-sand text-ink text-sm">Cancel</button>
              <button onClick={apply} disabled={busy} className="px-5 py-2 rounded-full bg-emerald text-white text-sm font-medium disabled:opacity-50">
                {busy ? "Applying…" : `Apply to ${preview.rewritten} products`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
