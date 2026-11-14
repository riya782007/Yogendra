"use client";
import { useEffect, useState } from "react";
import { formatPaise } from "@/lib/pricing";
import { recordReturnAction, listReceiveAccountsAction, returnRefundDefaultsAction } from "@/app/actions/billing";

type Order = { id: string; total: number; customer_name: string | null; created_at: string; order_items: { qty: number; product: { id: string; name: string; sku: string }; variant?: { sku: string; color: string | null } | null }[] };
// A returnable line is identified by product + variant, so two colours of the same design don't merge.
const lineKey = (it: Order["order_items"][number]) => `${it.product.id}::${it.variant?.sku ?? ""}`;
// Short colour summary for the dropdown so the owner spots the variant before opening the order.
const colourSummary = (o: Order): string => {
  const cols = Array.from(new Set((o.order_items ?? []).map((it) => it.variant?.color).filter((c): c is string => !!c)));
  if (cols.length === 0) return "";
  const shown = cols.slice(0, 3).join(", ");
  return cols.length > 3 ? `${shown} +${cols.length - 3}` : shown;
};

export function ReturnClient({ orders }: { orders: Order[] }) {
  const [sel, setSel] = useState<string>("");
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const order = orders.find((o) => o.id === sel);
  // Which account the refund goes OUT of (Cash / UPI / Kotak / HDFC …); "" = no money back.
  const [accounts, setAccounts] = useState<{ id: string; name: string; isDefault: boolean; kind: string }[]>([]);
  const [refundFrom, setRefundFrom] = useState("");
  useEffect(() => { listReceiveAccountsAction().then(setAccounts).catch(() => {}); }, []);
  useEffect(() => {
    if (!sel) return;
    returnRefundDefaultsAction(sel).then((d) => {
      const cash = accounts.find((a) => a.kind?.toLowerCase() === "cash") ?? accounts.find((a) => a.isDefault);
      setRefundFrom(d.paid > 0 ? (d.methodId && accounts.some((a) => a.id === d.methodId) ? d.methodId : cash?.id ?? "") : "");
    }).catch(() => {});
  }, [sel, accounts]);

  async function submit() {
    if (!order) return;
    const items = Object.entries(qty).filter(([, q]) => q > 0).map(([key, q]) => {
      const [product_id, variant_sku] = key.split("::");
      return { product_id, variantSku: variant_sku || undefined, qty: q };
    });
    setBusy(true); setMsg("");
    const res = await recordReturnAction({ orderId: order.id, reason, items, refundMethodId: refundFrom || null });
    setBusy(false);
    if (res.ok && res.pending) { setMsg("⏳ Sent to the owner for approval — the return will be processed once they clear it on the Approvals page."); setSel(""); setQty({}); setReason(""); }
    else if (res.ok) { setMsg(`✓ Return recorded · ${res.qty} pcs restored to stock${res.refunded && res.refunded > 0 ? ` · ${formatPaise(res.refunded)} refunded from ${res.refundAccount}` : ""}`); setSel(""); setQty({}); setReason(""); }
    else setMsg(`✕ ${res.error}`);
  }
  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  return (
    <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
      <h2 className="font-medium text-ink mb-3">Record a sales return</h2>
      <select className={input} value={sel} onChange={(e) => { setSel(e.target.value); setQty({}); }}>
        <option value="">Select an order…</option>
        {orders.map((o) => { const c = colourSummary(o); return <option key={o.id} value={o.id}>{String(o.id).slice(0, 8).toUpperCase()} · {o.customer_name || "Walk-in"} · {formatPaise(o.total)}{c ? ` · ${c}` : ""}</option>; })}
      </select>
      {order && (
        <div className="mt-4 space-y-2">
          {order.order_items.map((it) => {
            const k = lineKey(it);
            return (
              <div key={k} className="flex items-center gap-3 text-sm border-b border-sand/60 py-2">
                <span className="flex-1">
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
          <input className={input + " mt-2"} placeholder="Reason (e.g. wrong colour / damaged / not purchased)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <label className="block text-xs text-muted mt-2">Refund paid from
            <select className={input + " mt-1 text-ink"} value={refundFrom} onChange={(e) => setRefundFrom(e.target.value)}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value="">No refund — keep as credit / adjust in balance</option>
            </select>
          </label>
          <button onClick={submit} disabled={busy} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-50 mt-2">{busy ? "Recording…" : "Record return & restore stock"}</button>
        </div>
      )}
      {msg && <p className="text-sm mt-2 text-ink">{msg}</p>}
    </div>
  );
}
