"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { verifyWholesalePaymentAction } from "@/app/actions/wholesale";

type Order = {
  id: string; invoice_no: string | null; customer_name: string | null; customer_phone: string | null;
  total: number; amount_paid: number; payment_ref: string | null; proofUrl: string | null; created_at: string;
  items: { name: string; sku: string | null; qty: number; image: string | null }[];
};

/** One wholesale order awaiting payment approval: the dealer's screenshot on the left, the order + a
 *  big Approve / Reject on the right. Approve marks it paid and records the money received. */
export function WholesalePaymentCard({ order }: { order: Order }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmReject, setConfirmReject] = useState(false);

  async function decide(approve: boolean) {
    setBusy(true); setMsg(null);
    const r = await verifyWholesalePaymentAction({ orderId: order.id, approve });
    setBusy(false); setConfirmReject(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't update.", ok: false }); return; }
    setMsg({ text: approve ? "Payment approved ✓ — order can be dispatched." : "Marked rejected — follow up with the dealer.", ok: approve });
    router.refresh();
  }

  const when = new Date(order.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const phone = order.customer_phone ? String(order.customer_phone).replace(/\D/g, "") : "";
  const wa = phone ? `https://wa.me/${phone}` : null;

  return (
    <div className="bg-white rounded-2xl shadow-card p-4 flex flex-col sm:flex-row gap-4">
      {/* Screenshot */}
      <div className="shrink-0">
        {order.proofUrl ? (
          <button onClick={() => setZoom(true)} className="block w-28 h-40 rounded-xl overflow-hidden border border-sand bg-cream cursor-zoom-in" title="Tap to enlarge">
            <img src={order.proofUrl} alt="Payment screenshot" className="w-full h-full object-cover" />
          </button>
        ) : (
          <div className="w-28 h-40 rounded-xl border border-dashed border-gold/50 bg-gold/5 grid place-items-center text-[11px] text-gold-dark text-center p-2">No screenshot — dealer entered a UPI ref only</div>
        )}
      </div>

      {/* Details + actions */}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-ink">{order.customer_name || "Wholesale dealer"}</p>
          <span className="text-xs text-muted">· {order.invoice_no || order.id.slice(0, 8).toUpperCase()} · {when}</span>
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-xs text-emerald nav-link">WhatsApp →</a>}
        </div>
        {/* Items as a photo list — verify exactly what's being shipped, not a cramped comma line. */}
        <div className="mt-2 grid gap-1.5">
          {order.items.length === 0 && <p className="text-sm text-muted">—</p>}
          {order.items.map((it, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div className="h-11 w-10 rounded-lg overflow-hidden bg-cream border border-sand shrink-0">
                {it.image ? <img src={it.image} alt="" className="w-full h-full object-cover" /> : <span className="flex items-center justify-center h-full text-[10px] text-muted">—</span>}
              </div>
              <div className="min-w-0">
                <p className="text-sm text-ink leading-tight">{it.name}</p>
                <p className="text-xs text-muted"><span className="font-mono">{it.sku}</span> · Qty <b className="text-ink">{it.qty}</b></p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-sm">
          <span>Amount: <b className="text-ink">{formatPaise(order.total)}</b></span>
          {order.payment_ref && <span className="text-muted">UPI ref: <span className="font-mono text-ink">{order.payment_ref}</span></span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button onClick={() => decide(true)} disabled={busy} className="px-4 py-2 rounded-full bg-emerald text-white text-sm font-medium hover:bg-emerald-dark disabled:opacity-50">✓ Approve payment</button>
          {confirmReject ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <span className="text-rose text-xs">Reject this?</span>
              <button onClick={() => decide(false)} disabled={busy} className="px-3 py-1.5 rounded-full bg-rose text-white text-xs disabled:opacity-50">Yes, reject</button>
              <button onClick={() => setConfirmReject(false)} className="px-3 py-1.5 rounded-full border border-sand text-muted text-xs">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmReject(true)} disabled={busy} className="px-4 py-2 rounded-full border border-rose/40 text-rose text-sm hover:bg-rose/5 disabled:opacity-50">Reject</button>
          )}
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</span>}
        </div>
      </div>

      {zoom && order.proofUrl && (
        <div className="fixed inset-0 z-[100] bg-ink/90 grid place-items-center p-5" onClick={() => setZoom(false)}>
          <button onClick={() => setZoom(false)} className="absolute top-4 right-5 text-cream/80 hover:text-white text-3xl">✕</button>
          <img src={order.proofUrl} alt="Payment screenshot" className="max-w-[92vw] max-h-[88vh] object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
