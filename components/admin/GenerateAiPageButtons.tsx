"use client";
/**
 * AI page buttons for the Catalogue. They used to be bare server forms: if the request was killed at
 * the host's 10-second limit the owner saw nothing at all — "AI page generator is not working".
 * Now each shows what is happening and what came back.
 */
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { generateContentAction, listProductsMissingAiAction } from "@/app/actions/aiContent";

export function GenerateAiPageButton({ sku, hasAi }: { sku: string; hasAi: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [msg, setMsg] = useState("");
  async function run() {
    setState("busy"); setMsg("");
    try {
      const r = await generateContentAction(sku);
      if (r.ok) {
        setState("ok"); setMsg(r.fallbackUsed ? "Written from the product details" : "Written ✓");
        router.refresh();
      } else { setState("err"); setMsg(r.error || "Couldn't write it — try again"); }
    } catch { setState("err"); setMsg("Couldn't reach the server — try again"); }
  }
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={run} disabled={state === "busy"}
        className="px-3 py-1.5 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20 disabled:opacity-60">
        {state === "busy" ? "Writing…" : hasAi ? "Regenerate AI page" : "Generate AI page"}
      </button>
      {msg && <span className={`text-[10px] mt-0.5 ${state === "err" ? "text-rose" : "text-emerald-dark"}`}>{msg}</span>}
    </span>
  );
}

/** Writes pages for every published product that has none — one product per request, with progress
 *  and a Stop button, so no single request can hit the host's time limit. */
export function GenerateMissingAiPagesButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const stop = useRef(false);
  async function run() {
    setBusy(true); stop.current = false; setMsg("Finding products without a page…");
    try {
      const { skus } = await listProductsMissingAiAction();
      if (!skus.length) { setMsg("Every published product already has an AI page ✓"); return; }
      let ok = 0, fail = 0;
      for (let i = 0; i < skus.length; i++) {
        if (stop.current) break;
        setMsg(`Writing ${i + 1} of ${skus.length} (${skus[i]})…`);
        try { const r = await generateContentAction(skus[i]); r.ok ? ok++ : fail++; } catch { fail++; }
      }
      setMsg(`${stop.current ? "Stopped. " : ""}${ok} page${ok === 1 ? "" : "s"} written${fail ? ` · ${fail} skipped (try again later)` : ""}.`);
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={run} disabled={busy} className="btn-primary px-4 py-2.5 text-sm font-medium disabled:opacity-60">
        {busy ? "Writing AI pages…" : "✨ Write missing AI pages"}
      </button>
      {busy && <button type="button" onClick={() => { stop.current = true; }} className="text-xs text-muted hover:text-rose">Stop</button>}
      {msg && <span className="text-xs text-muted max-w-[16rem]">{msg}</span>}
    </span>
  );
}
