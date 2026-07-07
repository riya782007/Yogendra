"use client";
/**
 * PurchaseReturnClient — record a PURCHASE RETURN right on the Returns page (client request:
 * "return me purchase returns"). Pick a recent purchase bill → its lines load with variant
 * colour, unit cost, per-line cap (bought − already returned) AND an open-backorder warning
 * ("backorder at the time of purchase return"): pieces still promised to open backorders are
 * flagged before they leave for the supplier. Uses the same RPC as the purchase-bill dialog.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { fetchPurchaseForReturnAction, recordPurchaseReturnAction } from "@/app/actions/purchases";

type Purchase = { id: string; bill_no: string | null; total: number; created_at: string; supplier?: { name?: string | null } | null; purchase_items?: { qty: number }[] };
type Item = { productId: string; variantId: string | null; name: string; sku: string; color: string | null; qty: number; returned: number; returnable: number; unitCost: number; backorderQty: number };
const key = (it: Item) => `${it.productId}::${it.variantId ?? ""}`;

export function PurchaseReturnClient({ purchases }: { purchases: Purchase[] }) {
  const router = useRouter();
  const [sel, setSel] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function pick(id: string) {
    setSel(id); setItems(null); setQty({}); setMsg("");
    if (!id) return;
    setLoading(true);
    const r = await fetchPurchaseForReturnAction(id);
    setLoading(false);
    if (r.ok && r.items) setItems(r.items as Item[]);
    else setMsg(r.error ?? "Couldn't load the bill.");
  }

  async function submit() {
    if (!sel || !items) return;
    const selLines = Object.entries(qty).filter(([, q]) => q > 0).map(([k, q]) => {
      const [productId, variantId] = k.split("::");
      return { productId, variantId: variantId || null, qty: q };
    });
    if (!selLines.length) { setMsg("Set a return qty on at least one line."); return; }
    if (!reason.trim()) { setMsg("Add a reason (damaged, wrong goods, excess…)."); return; }
    setBusy(true); setMsg("");
    const res = await recordPurchaseReturnAction({ purchaseId: sel, reason, items: selLines });
    setBusy(false);
    if (res.ok) {
      setMsg(`✓ Returned ${res.qty} pcs to supplier · debit note ${formatPaise(res.amount ?? 0)}`);
      setSel(""); setItems(null); setQty({}); setReason("");
      router.refresh();
    } else setMsg(`✕ ${res.error}`);
  }

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  const allClosed = !!items && items.every((it) => it.returnable <= 0);

  return (
    <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
      <h2 className="font-medium text-ink mb-1">Record a purchase return <span className="text-xs text-muted font-normal">· goods back to the supplier (debit note)</span></h2>
      <p className="text-[11px] text-muted mb-3">Stock leaves the exact colour; the value posts as a debit note against the supplier. Lines promised to open backorders are flagged.</p>
      <select className={input} value={sel} onChange={(e) => pick(e.target.value)}>
        <option value="">Select a purchase bill…</option>
        {purchases.map((p) => {
          const pcs = (p.purchase_items ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
          return (
            <option key={p.id} value={p.id}>
              {(p.bill_no || String(p.id).slice(0, 8).toUpperCase())} · {p.supplier?.name ?? "Supplier"} · {formatPaise(p.total ?? 0)}{pcs ? ` · ${pcs} pcs` : ""} · {new Date(p.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
            </option>
          );
        })}
      </select>

      {loading && <p className="text-sm text-muted mt-3">Loading bill lines…</p>}

      {items && (
        <div className="mt-4 space-y-2">
          {allClosed && <p className="text-sm text-emerald-dark bg-emerald-mist rounded-xl px-3 py-2">✓ Everything on this bill has already been returned to the supplier.</p>}
          {items.map((it) => {
            const k = key(it);
            const closed = it.returnable <= 0;
            return (
              <div key={k} className={`flex flex-wrap items-center gap-3 text-sm border-b border-sand/60 py-2 ${closed ? "opacity-60" : ""}`}>
                <span className="flex-1 min-w-0 truncate">
                  {it.name}{it.color ? <span className="text-ink"> · {it.color}</span> : ""}
                  <span className="text-muted"> · {it.sku} · bought {it.qty} @ {formatPaise(it.unitCost)}{it.returned > 0 ? ` · ${it.returned} returned` : ""}</span>
                  {it.backorderQty > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-gold/15 text-gold-dark whitespace-nowrap" title="Open backorders still need these pieces — fulfil them before sending stock back">
                      ⚠ {it.backorderQty} needed by open backorders
                    </span>
                  )}
                </span>
                {closed ? (
                  <span className="text-[11px] text-emerald-dark whitespace-nowrap">✓ fully returned</span>
                ) : (
                  <>
                    <label className="text-xs text-muted">return (max {it.returnable})</label>
                    <input type="number" min={0} max={it.returnable} value={qty[k] ?? 0}
                      onChange={(e) => setQty({ ...qty, [k]: Math.min(it.returnable, Math.max(0, Number(e.target.value))) })}
                      className="w-16 rounded-lg border border-sand px-2 py-1 text-sm" />
                  </>
                )}
              </div>
            );
          })}
          {!allClosed && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (damaged, wrong goods, excess stock…)" className={`${input} mt-2`} />
          )}
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-xs text-muted">{msg}</span>
            {!allClosed && (
              <button onClick={submit} disabled={busy} className="px-5 py-2.5 rounded-xl bg-rose text-white text-sm hover:opacity-90 disabled:opacity-50">
                {busy ? "Recording…" : "Record purchase return"}
              </button>
            )}
          </div>
        </div>
      )}
      {!items && msg && <p className="text-sm text-rose mt-2">{msg}</p>}
    </div>
  );
}
