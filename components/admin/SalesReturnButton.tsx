"use client";
/**
 * SalesReturnButton — record a sales return DIRECTLY from the bill's row on the Sales page.
 * With thousands of bills a day, hunting for the order again in a separate Returns module is a
 * hassle; here the return starts from the row you're already looking at. Uses the exact same
 * recordReturnAction as the Returns module (staff → owner approval, owner → instant restock),
 * so nothing about the return logic forks.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { fetchOrderForReturnAction, recordReturnAction } from "@/app/actions/billing";

type Item = { qty: number; product: { id: string; name: string; sku: string }; variant: { sku: string; color: string | null } | null };
const lineKey = (it: Item) => `${it.product.id}::${it.variant?.sku ?? ""}`;

export function SalesReturnButton({ orderId, invoiceNo }: { orderId: string; invoiceNo?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function openDialog(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(true); setLoading(true); setMsg(""); setQty({}); setReason("");
    const r = await fetchOrderForReturnAction(orderId);
    setLoading(false);
    if (r.ok && r.order) setItems(r.order.items);
    else { setItems(null); setMsg(r.error ?? "Couldn't load the bill."); }
  }

  async function submit() {
    if (!items) return;
    const sel = Object.entries(qty).filter(([, q]) => q > 0).map(([key, q]) => {
      const [product_id, variant_sku] = key.split("::");
      return { product_id, variantSku: variant_sku || undefined, qty: q };
    });
    if (!sel.length) { setMsg("Set a return qty on at least one line."); return; }
    if (!reason.trim()) { setMsg("Add a return reason."); return; }
    setBusy(true); setMsg("");
    const res = await recordReturnAction({ orderId, reason, items: sel });
    setBusy(false);
    if (res.ok && res.pending) { setMsg("⏳ Sent to the owner for approval."); }
    else if (res.ok) { setMsg(`✓ Return recorded · ${res.qty} pcs restocked`); router.refresh(); }
    else { setMsg(`✕ ${res.error}`); return; }
    setTimeout(() => setOpen(false), 1400);
  }

  return (
    <>
      <button onClick={openDialog} title="Record a sales return against this bill"
        className="text-xs px-2 py-1 rounded-full border border-sand text-muted hover:border-rose hover:text-rose whitespace-nowrap">
        ↩ Return
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4" onClick={(e) => e.stopPropagation()}>
          <div className="absolute inset-0 bg-ink/40" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-luxe border border-sand p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto">
            <p className="font-medium text-ink mb-1">Sales return — {invoiceNo || String(orderId).slice(0, 8).toUpperCase()}</p>
            {loading && <p className="text-sm text-muted py-3">Loading bill lines…</p>}
            {!loading && items && (
              <>
                <div className="mt-2 space-y-1">
                  {items.map((it) => {
                    const k = lineKey(it);
                    return (
                      <div key={k} className="flex items-center gap-3 text-sm border-b border-sand/60 py-2">
                        <span className="flex-1 min-w-0 truncate">
                          {it.product.name}{it.variant?.color ? <span className="text-ink"> · {it.variant.color}</span> : ""}
                          <span className="text-muted"> · {it.variant?.sku ?? it.product.sku} · sold {it.qty}</span>
                        </span>
                        <label className="text-xs text-muted">return</label>
                        <input type="number" min={0} max={it.qty} value={qty[k] ?? 0}
                          onChange={(e) => setQty({ ...qty, [k]: Math.min(it.qty, Math.max(0, Number(e.target.value))) })}
                          className="w-16 rounded-lg border border-sand px-2 py-1 text-sm" />
                      </div>
                    );
                  })}
                </div>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (damaged, wrong colour, customer changed mind…)"
                  className="w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm bg-white outline-none focus:border-emerald mt-3" />
                <div className="flex items-center justify-between gap-2 mt-4">
                  <span className="text-xs text-muted">{msg}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">Cancel</button>
                    <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-xl bg-rose text-white text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Recording…" : "Record return"}</button>
                  </div>
                </div>
              </>
            )}
            {!loading && !items && <p className="text-sm text-rose py-2">{msg}</p>}
          </div>
        </div>
      )}
    </>
  );
}
