"use client";
import { useState } from "react";

export function PasscodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return (
    <button onClick={copy} title="Copy passcode"
      className="inline-flex items-center gap-1.5 rounded-lg bg-ink/5 hover:bg-ink/10 px-2.5 py-1 font-mono text-sm tracking-widest text-ink transition-colors">
      {code} <span className="text-[10px] text-muted">{copied ? "copied ✓" : "copy"}</span>
    </button>
  );
}
