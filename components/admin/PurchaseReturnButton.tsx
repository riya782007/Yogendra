"use client";
/**
 * PurchaseReturnButton — return goods TO THE SUPPLIER straight from the purchase bill page.
 * Mirrors the sales-return dialog: per-line caps (bought − already returned), variant-exact
 * stock out, debit note posted to the money ledger, movement visible in Stock Movement.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { fetchPurchaseForReturnAction, recordPurchaseReturnAction } from "@/app/actions/purchases";

type Item = { productId: string; variantId: string | null; name: string; sku: string; color: string | null; qty: number; returned: number; returnable: number; unitCost: number; backorderQty?: number };
const key = (it: Item) => `${it.productId}::${it.variantId ?? ""}`;

export function PurchaseReturnButton({ purchaseId, billNo }: { purchaseId: string; billNo?: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function openDialog() {
    setOpen(true); setLoading(true); setMsg(""); setQty({}); setReason("");
    const r = await fetchPurchaseForReturnAction(purchaseId);
    setLoading(false);
    if (r.ok && r.items) setItems(r.items);
    else { setItems(null); setMsg(r.error ?? "Couldn't load the bill."); }
  }

  async function submit() {
    if (!items) return;
    const sel = Object.entries(qty).filter(([, q]) => q > 0).map(([k, q]) => {
      const [productId, variantId] = k.split("::");
      return { productId, variantId: variantId || null, qty: q };
    });
    if (!sel.length) { setMsg("Set a return qty on at least one line."); return; }
    if (!reason.trim()) { setMsg("Add a reason (damaged, wrong goods, excess…)."); return; }
    setBusy(true); setMsg("");
    const res = await recordPurchaseReturnAction({ purchaseId, reason, items: sel });
    setBusy(false);
    if (res.ok) {
      if (res.returnId) { router.push(`/admin/returns/${res.returnId}`); return; }
      setMsg(`✓ Returned ${res.qty} pcs to supplier · debit note ${formatPaise(res.amount ?? 0)}`);
      router.refresh(); setTimeout(() => setOpen(false), 1600);
    } else setMsg(`✕ ${res.error}`);
  }

  const allClosed = !!items && items.every((it) => it.returnable <= 0);

  return (
    <>
      <button onClick={openDialog} title="Return goods from this bill back to the supplier"
        className="px-3 py-1.5 rounded-full border border-sand text-sm text-muted hover:border-rose hover:text-rose whitespace-nowrap">
        ↩ Return to supplier
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-luxe border border-sand p-5 max-w-lg w-full max-h-[85vh] overflow-y-auto">
            <p className="font-medium text-ink mb-1">Purchase return — {billNo || String(purchaseId).slice(0, 8).toUpperCase()}</p>
            {loading && <p className="text-sm text-muted py-3">Loading bill lines…</p>}
            {!loading && items && (
              <>
                {allClosed ? (
                  <p className="text-sm text-emerald-dark bg-emerald-mist rounded-xl px-3 py-2 mt-2">
                    ✓ Everything on this bill has already been returned to the supplier.
                  </p>
                ) : (
                  <div className="mt-2 space-y-1">
                    {items.map((it) => {
                      const k = key(it);
                      const closed = it.returnable <= 0;
                      return (
                        <div key={k} className={`flex items-center gap-3 text-sm border-b border-sand/60 py-2 ${closed ? "opacity-60" : ""}`}>
                          <span className="flex-1 min-w-0 truncate">
                            {it.name}{it.color ? <span className="text-ink"> · {it.color}</span> : ""}
                            <span className="text-muted"> · {it.sku} · bought {it.qty} @ {formatPaise(it.unitCost)}{it.returned > 0 ? ` · ${it.returned} returned` : ""}</span>
                            {(it.backorderQty ?? 0) > 0 && <span className="ml-2 px-1.5 py-0.5 rounded-full text-[10px] bg-gold/15 text-gold-dark whitespace-nowrap" title="Open backorders still need these pieces — fulfil them before sending stock back">⚠ {it.backorderQty} needed by open backorders</span>}
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
                  </div>
                )}
                {!allClosed && (
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (damaged, wrong goods, excess stock…)"
                    className="w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm bg-white outline-none focus:border-emerald mt-3" />
                )}
                <div className="flex items-center justify-between gap-2 mt-4">
                  <span className="text-xs text-muted">{msg}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">{allClosed ? "Close" : "Cancel"}</button>
                    {!allClosed && (
                      <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-xl bg-rose text-white text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Recording…" : "Record purchase return"}</button>
                    )}
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
