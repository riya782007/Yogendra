"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { cleanupDuplicateColoursAction } from "@/app/actions/options";

/** One-tap: remap SILVAR/silver/Silver2 onto the catalog, merge duplicate variants, delete extra master rows. */
export function DeduplicateColoursButton({ extras }: { extras: number }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  if (extras <= 0) return null;
  const working = busy || pending;

  async function run() {
    setBusy(true);
    const res = await cleanupDuplicateColoursAction();
    setBusy(false);
    if (res.error) { toast(res.error, "error"); return; }
    toast(`Cleaned colours — ${res.deletedOptions} extra names removed, ${res.remapped} variants remapped, ${res.merged} duplicate colour-rows merged`);
    start(() => router.refresh());
  }

  return (
    <button type="button" onClick={run} disabled={working}
      className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-rose/10 text-rose hover:bg-rose/15 disabled:opacity-60"
      title="SILVAR, silver, Silver2 etc. become Silver / Silver 2 — extra master names are deleted">
      {working ? "Cleaning…" : `🧹 Remove ${extras} extra colour spelling${extras === 1 ? "" : "s"}`}
    </button>
  );
}
