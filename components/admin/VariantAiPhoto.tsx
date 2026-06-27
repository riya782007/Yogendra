"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateVariantImageAction } from "@/app/actions/variants";

const REASON: Record<string, string> = {
  no_attribute: "Add a colour, size, or polish to this variant first.",
  no_color: "Add a colour to this variant first.",
  no_source: "Add a product photo first (the AI recolours that).",
  no_key: "No image AI key configured.",
  not_permitted: "You don't have photo-AI permission.",
  upload_failed: "Couldn't save the image — try again.",
  api_error: "The image service didn't respond — try again.",
  no_image: "The AI returned no image — try again.",
};

/**
 * Module 3 — one-tap "Generate {attribute} photo" for a variant. Shows live progress
 * (Gemini takes a few seconds) and refreshes the page when the new image lands.
 */
export default function VariantAiPhoto({
  variantId,
  color,
  size,
  polish,
}: {
  variantId: string;
  color: string | null;
  size?: string | null;
  polish?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Pillar 16: the AI button is available for any variant that has at least one
  // distinguishing attribute (colour OR size OR polish), not only colour.
  const label = (color || size || polish || "").trim();
  if (!label) return null;

  async function run() {
    setMsg(null);
    setBusy(true);
    const res = await generateVariantImageAction(variantId);
    setBusy(false);
    if (res.ok) {
      setMsg("done");
      start(() => router.refresh());
      setTimeout(() => setMsg(null), 2500);
    } else {
      setMsg(REASON[res.reason ?? ""] ?? res.error ?? "Couldn't generate — try again.");
    }
  }

  const working = busy || pending;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={working}
        className="px-2.5 py-1.5 rounded-lg bg-gold/15 text-gold-dark text-xs font-medium hover:bg-gold/25 disabled:opacity-60 inline-flex items-center gap-1.5"
        title={`Generate a professional ${label} photo with AI`}
      >
        {working ? (
          <>
            <span className="h-3 w-3 rounded-full border-2 border-gold-dark/40 border-t-gold-dark animate-spin" />
            Generating {label}…
          </>
        ) : (
          <>✨ AI {label} photo</>
        )}
      </button>
      {msg === "done" ? (
        <span className="text-[11px] text-emerald-dark">Added ✓</span>
      ) : msg ? (
        <span className="text-[11px] text-rose">{msg}</span>
      ) : null}
    </div>
  );
}
