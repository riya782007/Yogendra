"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { bulkSetMoreDesignsAction } from "@/app/actions/enquiries";

/**
 * Applies the "More designs available" flag to an ENTIRE category in one go. With 4,000+ products,
 * ticking designs one at a time isn't realistic — most owners want it on a whole range (e.g. all
 * Necklaces) and then switch off the few exceptions from the row toggle.
 */
export function MoreDesignsBulk({ categories }: { categories: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [catId, setCatId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function apply(on: boolean) {
    if (!catId) { setMsg("Pick a category first."); return; }
    setBusy(true); setMsg("");
    const r = await bulkSetMoreDesignsAction({ categoryId: catId, on, note });
    setBusy(false);
    setMsg(r.ok ? `${on ? "Marked" : "Cleared"} ${r.count ?? 0} designs ✓` : (r.error ?? "Couldn't apply."));
    if (r.ok) router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-3 text-xs px-3 py-1.5 rounded-full border border-gold/50 text-gold-dark hover:bg-gold/10">
        ✨ Bulk: mark a category as “more designs available”
      </button>
    );
  }

  return (
    <div className="mb-4 rounded-2xl border border-gold/40 bg-white p-4">
      <p className="text-sm font-medium text-ink">Mark a whole category as “more designs available”</p>
      <p className="text-xs text-muted mt-0.5 mb-3">
        Dealers on the wholesale panel will see a button on these designs to request the full colour range —
        by video call, a store visit, or photos on WhatsApp. Every request lands in <span className="text-ink">Design Enquiries</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={catId} onChange={(e) => setCatId(e.target.value)} className="rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-gold">
          <option value="">Choose category…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input
          value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note dealers see, e.g. “25+ colours in store”"
          className="rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-gold flex-1 min-w-[220px]"
        />
        <button onClick={() => apply(true)} disabled={busy} className="px-3 py-2 rounded-full bg-ink text-cream text-xs font-medium disabled:opacity-50">{busy ? "Applying…" : "Turn ON"}</button>
        <button onClick={() => apply(false)} disabled={busy} className="px-3 py-2 rounded-full border border-sand text-muted text-xs disabled:opacity-50">Turn OFF</button>
        <button onClick={() => { setOpen(false); setMsg(""); }} className="px-3 py-2 text-xs text-muted underline">Close</button>
      </div>
      {msg && <p className="text-xs text-emerald-dark mt-2">{msg}</p>}
    </div>
  );
}
