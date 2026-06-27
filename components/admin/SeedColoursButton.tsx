"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { seedDefaultColoursAction } from "@/app/actions/options";

/** One-tap button that pours the canonical 75-colour catalog into variant_options.
 *  Idempotent — refreshes `barcode_code` + `sort` on existing rows; preserves user-set
 *  `hex` swatches. Shows "Already seeded" once every catalog name is present so the
 *  owner can tell at a glance whether their master is in sync. */
export function SeedColoursButton({ seeded, total }: { seeded: number; total: number }) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);

  // 75 is the count of names in lib/colors.ts — used only to label the button.
  const CATALOG_SIZE = 75;
  const fullySeeded = seeded >= CATALOG_SIZE;
  const working = busy || pending;

  async function run() {
    setBusy(true);
    const res = await seedDefaultColoursAction();
    setBusy(false);
    if (!res || (res.created === 0 && res.updated === 0)) {
      toast("Seed action skipped — check your permissions.", "error");
      return;
    }
    toast(`Canonical colours synced — ${res.created} added, ${res.updated} refreshed`);
    start(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={working}
      className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60 ${fullySeeded ? "bg-emerald-mist text-emerald-dark hover:bg-emerald-mist/70" : "bg-gold text-ink hover:bg-gold/85"}`}
      title="Insert / refresh the 75 canonical colours from lib/colors.ts"
    >
      {working ? (
        <>
          <span className="h-3 w-3 rounded-full border-2 border-ink/40 border-t-ink animate-spin" />
          Seeding…
        </>
      ) : fullySeeded ? (
        <>✓ Canonical 75 in place · re-sync</>
      ) : (
        <>✨ Seed canonical 75 colours{total > 0 ? ` (you have ${seeded}/${CATALOG_SIZE})` : ""}</>
      )}
    </button>
  );
}
