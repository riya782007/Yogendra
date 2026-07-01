"use client";
import { useState } from "react";

/** Passcodes are masked by default (a customer/looker can't read them off the screen).
 *  Click the eye to reveal, or copy without revealing. */
export function PasscodeChip({ code }: { code: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const isReal = !!code && code !== "—";
  const masked = isReal ? "•".repeat(Math.min(10, Math.max(4, code.length))) : code;
  async function copy(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  const toggle = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setShown((s) => !s); };
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink/5 px-2.5 py-1 font-mono text-sm tracking-widest text-ink">
      <span className="select-none">{shown ? code : masked}</span>
      {isReal && (
        <>
          <button onClick={toggle} title={shown ? "Hide" : "Reveal"} className="text-[11px] leading-none text-muted hover:text-ink transition-colors">{shown ? "🙈" : "👁"}</button>
          <button onClick={copy} title="Copy passcode" className="text-[10px] leading-none text-muted hover:text-ink transition-colors">{copied ? "copied ✓" : "copy"}</button>
        </>
      )}
    </span>
  );
}
