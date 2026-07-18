"use client";
import { useState } from "react";
import { setMoreDesignsAction } from "@/app/actions/enquiries";

/**
 * Marks ONE design as "this comes in more colours than the catalogue shows". Dealers on the wholesale
 * panel then get a "More designs available" button that requests a video call / store visit / photos.
 */
export function MoreDesignsToggle({ sku, initial }: { sku: string; initial: boolean }) {
  const [on, setOn] = useState(!!initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setBusy(true);
    const r = await setMoreDesignsAction({ sku, on: next });
    setBusy(false);
    if (r.ok) setOn(next);
    else alert(r.error ?? "Couldn't save.");
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={on ? "Dealers can request the full colour range of this design" : "Mark this design as having more colours available off-catalogue"}
      className={`px-3 py-1.5 rounded-full text-xs font-medium transition disabled:opacity-50 ${
        on ? "bg-gold/20 text-gold-dark border border-gold/50" : "bg-ink/5 text-muted border border-transparent hover:bg-ink/10"
      }`}
    >
      {busy ? "…" : on ? "✨ More designs ON" : "✨ More designs"}
    </button>
  );
}
