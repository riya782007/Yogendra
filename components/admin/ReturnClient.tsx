"use client";
import { useRef, useState } from "react";
import { formatPaise } from "@/lib/pricing";
import { fetchOrderForReturnAction, recordReturnAction } from "@/app/actions/billing";

type Order = { id: string; total: number; customer_name: string | null; created_at: string; order_items: { qty: number; product: { id: string; name: string; sku: string }; variant?: { sku: string; color: string | null } | null }[] };
type ReturnItem = { qty: number; returned: number; returnable: number; product: { id: string; name: string; sku: string }; variant: { sku: string; color: string | null } | null };
const lineKey = (it: ReturnItem) => `${it.product.id}::${it.variant?.sku ?? ""}`;
const colourSummary = (o: Order): string => {
  const cols = Array.from(new Set((o.order_items ?? []).map((it) => it.variant?.color).filter((c): c is string => !!c)));
  if (cols.length === 0) return "";
  const shown = cols.slice(0, 3).join(", ");
  return cols.length > 3 ? `${shown} +${cols.length - 3}` : shown;
};

export function ReturnClient({ orders }: { orders: Order[] }) {
  const [sel, setSel] = useState("");
  const [items, setItems] = useState<ReturnItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const requestId = useRef(0);

  async function pick(id: string) {
    const request = ++requestId.current;
    setSel(id); setItems(null); setQty({}); setReason(""); setMsg("");
    if (!id) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetchOrderForReturnAction(id);
      if (request !== requestId.current) return;
      if (res.ok && res.order) setItems(res.order.items);
      else setMsg(res.error ?? "Couldn't load the order.");
    } catch {
      if (request === requestId.current) setMsg("Couldn't load the order. Please try again.");
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }

  async function submit() {
    if (!sel || !items) return;
    const selected = Object.entries(qty).filter(([, q]) => q > 0).map(([key, q]) => {
      const [product_id, variantSku] = key.split("::");
      return { product_id, variantSku: variantSku || undefined, qty: q };
    });
    if (!selected.length) { setMsg("Set a return qty on at least one line."); return; }
    if (!reason.trim()) { setMsg("Add a return reason."); return; }
    setBusy(true); setMsg("");
    try {
      const res = await recordReturnAction({ orderId: sel, reason, items: selected });
      if (res.ok && res.pending) {
        setMsg("Sent to the owner for approval.");
        setSel(""); setItems(null); setQty({}); setReason("");
      } else if (res.ok) {
        setMsg(`Return recorded · ${res.qty} pcs restored to stock`);
        setSel(""); setItems(null); setQty({}); setReason("");
      } else setMsg(`✕ ${res.error}`);
    } catch {
      setMsg("Couldn't record the return. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  const allClosed = !!items && items.every((it) => it.returnable <= 0);
  return (
    <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
      <h2 className="font-medium text-ink mb-3">Record a sales return</h2>
      <select className={input} value={sel} onChange={(e) => pick(e.target.value)}>
        <option value="">Select an order…</option>
        {orders.map((o) => { const c = colourSummary(o); return <option key={o.id} value={o.id}>{String(o.id).slice(0, 8).toUpperCase()} · {o.customer_name || "Walk-in"} · {formatPaise(o.total)}{c ? ` · ${c}` : ""}</option>; })}
      </select>
      {loading && <p className="text-sm text-muted mt-3">Loading order lines…</p>}
      {items && (
        <div className="mt-4 space-y-2">
          {allClosed && <p className="text-sm text-emerald-dark bg-emerald-mist rounded-xl px-3 py-2">Everything on this order has already been returned.</p>}
          {items.map((it) => {
            const k = lineKey(it);
            const closed = it.returnable <= 0;
            return (
              <div key={k} className={`flex items-center gap-3 text-sm border-b border-sand/60 py-2 ${closed ? "opacity-60" : ""}`}>
                <span className="flex-1 min-w-0 truncate">
                  {it.product.name}{it.variant?.color ? <span className="text-ink"> · {it.variant.color}</span> : ""}
                  <span className="text-muted"> · {it.variant?.sku ?? it.product.sku} · sold {it.qty}{it.returned > 0 ? ` · ${it.returned} returned` : ""}</span>
                </span>
                {closed ? <span className="text-[11px] text-emerald-dark whitespace-nowrap">fully returned</span> : <>
                  <label className="text-xs text-muted">return (max {it.returnable})</label>
                  <input type="number" min={0} max={it.returnable} value={qty[k] ?? 0}
                    onChange={(e) => setQty({ ...qty, [k]: Math.min(it.returnable, Math.max(0, Number(e.target.value))) })}
                    className="w-16 rounded-lg border border-sand px-2 py-1 text-sm" />
                </>}
              </div>
            );
          })}
          {!allClosed && <input className={`${input} mt-2`} placeholder="Reason (e.g. wrong colour / damaged / not purchased)" value={reason} onChange={(e) => setReason(e.target.value)} />}
          {!allClosed && <button onClick={submit} disabled={busy} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-50 mt-2">{busy ? "Recording…" : "Record return & restore stock"}</button>}
        </div>
      )}
      {msg && <p className="text-sm mt-2 text-ink">{msg}</p>}
    </div>
  );
}
