"use client";

import { useState } from "react";
import { addColourVariantsAction } from "@/app/actions/variants";

/** Quick expansion for a design that has arrived in several colours. It intentionally inherits
 * product pricing; per-colour overrides and photos remain available in the existing rows above. */
export function AddColourVariantsForm({ parentSku }: { parentSku: string }) {
  const [colors, setColors] = useState("");
  const [qty, setQty] = useState("0");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMessage("");
    const r = await addColourVariantsAction({ productSku: parentSku, colors, qty: Number(qty) });
    setBusy(false);
    if (!r.ok) { setMessage(r.error ?? "Could not add colours."); return; }
    setColors(""); setQty("0");
    setMessage(`${r.added} colour${r.added === 1 ? "" : "s"} added.${r.skipped?.length ? ` Already present: ${r.skipped.join(", ")}.` : ""}`);
  }

  return <form onSubmit={submit} className="mt-4 rounded-xl border border-gold/40 bg-gold/5 p-3">
    <p className="text-sm font-medium text-ink">Add more colours to this design</p>
    <p className="mt-0.5 text-[11px] text-muted">Enter comma-separated colours or one colour per line. Each gets its own variant, barcode SKU and opening-stock record. Prices follow the parent product.</p>
    <div className="mt-2 flex flex-wrap items-end gap-2">
      <label className="flex-1 min-w-[220px] text-[11px] text-muted">Colours
        <input required value={colors} onChange={(e) => setColors(e.target.value)} placeholder="e.g. Red, Green, Blue" className="mt-0.5 block w-full rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-gold" />
      </label>
      <label className="text-[11px] text-muted">Stock each
        <input required type="number" min="0" step="1" value={qty} onChange={(e) => setQty(e.target.value)} className="mt-0.5 block w-24 rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-gold" />
      </label>
      <button disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">{busy ? "Adding…" : "+ Add colours"}</button>
    </div>
    {message && <p role="status" className="mt-2 text-xs text-emerald-dark">{message}</p>}
  </form>;
}
