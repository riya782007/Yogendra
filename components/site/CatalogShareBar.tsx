"use client";
import { useState } from "react";

export function CatalogShareBar({ shareText }: { shareText: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => (typeof window !== "undefined" ? window.location.href : "");

  function copy() {
    navigator.clipboard?.writeText(url()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  }
  function whatsapp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText}\n${url()}`)}`, "_blank");
  }

  return (
    <div className="no-print flex flex-wrap gap-2">
      <button onClick={copy} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10 transition-colors">{copied ? "Link copied ✓" : "🔗 Copy link"}</button>
      <button onClick={whatsapp} className="px-4 py-2 rounded-full bg-emerald text-white text-sm hover:bg-emerald-dark transition-colors">Share on WhatsApp</button>
      <button onClick={() => window.print()} className="px-4 py-2 rounded-full bg-gold text-ink text-sm font-medium hover:opacity-90 transition-opacity">⤓ Save as PDF</button>
    </div>
  );
}
