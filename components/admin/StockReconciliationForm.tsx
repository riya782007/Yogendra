"use client";
import { useState } from "react";
import { SkuInput } from "@/components/admin/SkuInput";
import { findStockCountTargetAction, recordStockCountAction, type StockCountTarget } from "@/app/actions/stockReconciliation";

const REASONS = [
  ["damage", "Damaged / broken"], ["loss", "Lost / theft"], ["supplier_shortage", "Supplier shortage"],
  ["found_stock", "Found stock"], ["expiry", "Expired / unusable"], ["recount", "Recount correction"], ["other", "Other"],
];

export function StockReconciliationForm() {
  const [sku, setSku] = useState("");
  const [target, setTarget] = useState<StockCountTarget | null>(null);
  const [physicalQty, setPhysicalQty] = useState("");
  const [reason, setReason] = useState("recount");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadTarget() {
    setMessage(""); setTarget(null);
    const found = await findStockCountTargetAction(sku);
    if (!found) { setMessage("Use an exact simple-product SKU or a specific variant SKU."); return; }
    setTarget(found); setPhysicalQty(String(found.qty));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    setBusy(true); setMessage("");
    const r = await recordStockCountAction({ productId: target.productId, variantId: target.variantId, expectedQty: target.qty, physicalQty: Number(physicalQty), reason, note });
    setBusy(false);
    if (!r.ok) { setMessage(r.error ?? "Count was not recorded."); return; }
    setMessage("Count recorded in the immutable stock and value audit."); setTarget(null); setSku(""); setPhysicalQty(""); setNote("");
  }

  return <form onSubmit={submit} className="rounded-2xl border border-sand bg-white p-4 shadow-card">
    <h2 className="font-medium text-ink">Physical stock count</h2>
    <p className="mt-1 text-xs text-muted">Counts create an immutable movement and value-impact record. For products with colours, scan the colour/variant SKU.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-4 items-end">
      <label className="text-xs text-muted sm:col-span-2">SKU
        <SkuInput value={sku} onChange={(v) => { setSku(v); setTarget(null); }} placeholder="Search and select SKU…" className="mt-1 w-full rounded-xl border border-sand px-3 py-2 text-sm font-mono outline-none focus:border-emerald" />
      </label>
      <button type="button" onClick={loadTarget} disabled={!sku.trim() || busy} className="rounded-xl border border-emerald px-4 py-2 text-sm text-emerald disabled:opacity-50">Load system count</button>
      {target && <div className="rounded-xl bg-cream px-3 py-2 text-sm text-ink"><b>{target.qty}</b> system pcs<br /><span className="text-xs text-muted">{target.name} · {target.label}</span></div>}
    </div>
    {target && <div className="mt-3 grid gap-3 sm:grid-cols-3 items-end">
      <label className="text-xs text-muted">Physical quantity
        <input required min="0" step="1" type="number" value={physicalQty} onChange={(e) => setPhysicalQty(e.target.value)} className="mt-1 w-full rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald" />
      </label>
      <label className="text-xs text-muted">Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald">{REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </label>
      <label className="text-xs text-muted">Evidence / note
        <input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Count sheet, location, incident…" className="mt-1 w-full rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald" />
      </label>
    </div>}
    <div className="mt-3 flex items-center gap-3"><button disabled={!target || busy || Number(physicalQty) === target.qty} className="btn-primary px-5 py-2.5 text-sm disabled:opacity-50">{busy ? "Recording…" : "Record count"}</button>{message && <p className="text-sm text-muted" role="status">{message}</p>}</div>
  </form>;
}
