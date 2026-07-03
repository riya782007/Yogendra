"use client";
import { useState } from "react";
import { addProductTagAction, removeProductTagAction } from "@/app/actions/productTags";

/**
 * ProductTags — internal, admin-only status notes on a product (e.g. "inventory updated",
 * "variant images sorted"). The owner adds his own short tags; shown in the Catalogue and on any
 * product's admin page, NEVER on the storefront. `canEdit` gates add/remove.
 */
export function ProductTags({ sku, initial, canEdit = true, compact = false, stopClick = false }: {
  sku: string; initial: string[]; canEdit?: boolean; compact?: boolean; stopClick?: boolean;
}) {
  const [tags, setTags] = useState<string[]>(initial ?? []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  // In the catalogue the whole row toggles on click — stop clicks here from expanding/collapsing it.
  const stop = stopClick ? (e: React.MouseEvent) => e.stopPropagation() : undefined;

  async function add() {
    const t = draft.trim();
    if (!t || busy) return;
    setBusy(true);
    const r = await addProductTagAction(sku, t);
    setBusy(false);
    if (r.ok && r.tags) { setTags(r.tags); setDraft(""); setAdding(false); }
  }
  async function remove(tag: string) {
    if (busy) return;
    setBusy(true);
    const r = await removeProductTagAction(sku, tag);
    setBusy(false);
    if (r.ok && r.tags) setTags(r.tags);
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 ${compact ? "max-w-[220px]" : ""}`} onClick={stop}>
      {tags.length === 0 && !adding && !canEdit && <span className="text-[11px] text-muted">—</span>}
      {tags.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-gold/15 text-gold-dark text-[11px] px-2 py-0.5">
          {t}
          {canEdit && <button onClick={() => remove(t)} disabled={busy} className="text-gold-dark/60 hover:text-rose leading-none" title="Remove note">×</button>}
        </span>
      ))}
      {canEdit && (adding ? (
        <span className="inline-flex items-center gap-1" onClick={stop}>
          <input
            autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } else if (e.key === "Escape") { setAdding(false); setDraft(""); } }}
            placeholder="e.g. inventory updated"
            className="w-40 rounded-full border border-sand px-2.5 py-0.5 text-[11px] outline-none focus:border-emerald" />
          <button onClick={add} disabled={busy} className="text-[11px] text-emerald hover:underline">{busy ? "…" : "Add"}</button>
          <button onClick={() => { setAdding(false); setDraft(""); }} className="text-[11px] text-muted hover:text-ink">✕</button>
        </span>
      ) : (
        <button onClick={() => setAdding(true)} className="rounded-full border border-dashed border-sand text-muted hover:border-emerald hover:text-emerald text-[11px] px-2 py-0.5">+ note</button>
      ))}
    </div>
  );
}
