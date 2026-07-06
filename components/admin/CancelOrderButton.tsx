"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelOrderAction } from "@/app/actions/billing";

/** Owner-only: cancel an order (restocks items + reverses the sale). Confirms + captures a reason. */
export function CancelOrderButton({ orderId, cancelled = false }: { orderId: string; cancelled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  if (cancelled) return <span className="text-xs px-3 py-1 rounded-full bg-rose/10 text-rose">Cancelled</span>;

  async function go() {
    setBusy(true); setErr("");
    const res = await cancelOrderAction(orderId, reason);
    setBusy(false);
    if (res.ok) { setOpen(false); router.refresh(); }
    else setErr(res.error ?? "Could not cancel");
  }

  return (
    <>
      <button onClick={() => { setOpen(true); setErr(""); }} className="text-sm px-3 py-1.5 rounded-full border border-rose/40 text-rose hover:bg-rose/10">Cancel order</button>
      {open && (
        <div className="fixed inset-0 z-[90] bg-ink/60 backdrop-blur-sm grid place-items-center p-4 no-print" onClick={() => !busy && setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-luxe w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display text-xl text-ink">Cancel this order?</h3>
            <p className="text-sm text-muted mt-1">Stock will be returned to inventory and the sale reversed in your books. This can&apos;t be undone.</p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g. customer cancelled COD)" className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-rose mt-3" />
            {err && <p className="text-sm text-rose mt-2">{err}</p>}
            <div className="flex items-center gap-2 mt-4">
              <button onClick={go} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-rose text-white text-sm font-medium disabled:opacity-50">{busy ? "Cancelling…" : "Yes, cancel order"}</button>
              <button onClick={() => !busy && setOpen(false)} className="px-4 py-2.5 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Keep it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
