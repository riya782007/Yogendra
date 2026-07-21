"use client";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { generateOneAction } from "@/app/actions/images";

const MSG: Record<string, string> = {
  no_key: "Add GEMINI_API_KEY to generate photos",
  no_source: "Upload a raw product photo first (Add Inventory)",
  not_found: "Product not found",
};

export function GeneratePhotoButton({ sku }: { sku: string }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    const res = await generateOneAction(sku);
    setBusy(false);
    if (res.ok) toast(`Model photo generated for ${sku} ✓`);
    else toast(MSG[res.reason ?? ""] ?? `Couldn't generate: ${res.reason}`, "error");
  }
  return (
    <button onClick={run} disabled={busy} className="px-3 py-1.5 rounded-full bg-gold/15 text-gold-dark text-xs font-medium hover:bg-gold/25 transition-colors disabled:opacity-50">
      {busy ? "Generating…" : "Photo"}
    </button>
  );
}
