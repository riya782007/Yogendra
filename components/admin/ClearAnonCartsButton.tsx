"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearAnonymousCartsAction } from "@/app/actions/abandoned";

/** One-tap cleanup: remove every anonymous cart with no phone number — the ones that can't be chased. */
export function ClearAnonCartsButton() {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true); setMsg("");
    const r = await clearAnonymousCartsAction();
    setBusy(false); setConfirm(false);
    setMsg(r.ok ? `Cleared ${r.removed ?? 0} anonymous carts ✓` : (r.error ?? "Couldn't clear."));
    if (r.ok) router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      {confirm ? (
        <>
          <span className="text-xs text-muted">Delete all no-contact carts?</span>
          <button onClick={run} disabled={busy} className="text-xs px-3 py-1 rounded-full bg-rose text-white disabled:opacity-50">{busy ? "Clearing…" : "Yes, clear"}</button>
          <button onClick={() => setConfirm(false)} className="text-xs px-3 py-1 rounded-full border border-sand text-muted">Cancel</button>
        </>
      ) : (
        <button onClick={() => setConfirm(true)} className="text-xs px-3 py-1.5 rounded-full border border-sand text-muted hover:border-rose hover:text-rose">🧹 Clear anonymous carts</button>
      )}
      {msg && <span className="text-xs text-emerald-dark">{msg}</span>}
    </span>
  );
}
