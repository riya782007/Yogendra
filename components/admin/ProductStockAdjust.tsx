"use client";
/**
 * ProductStockAdjust — a stock add/remove control scoped to ONE product, with an
 * optional variant selector. Reuses the shared adjustStockAction (which logs to
 * stock_adjustments with a typed kind, and is permission-gated: inventory.add for +,
 * inventory.remove for −). Picking a variant adjusts that variant and rolls the
 * product total up from the sum of its variants.
 */
import { useState } from "react";
import { adjustStockAction } from "@/app/actions/stock";
import { QtyField } from "@/components/admin/QtyField";

const SOURCES = [
  "New purchase / restock",
  "Returned from cart (in-store)",
  "Customer cancelled",
  "Found / recount",
  "Sample returned",
  "Damaged — removed",
  "Correction",
  "Other",
];

type Variant = { id: string; sku: string; color: string | null; qty: number };

export function ProductStockAdjust({ sku, qty, variants = [] }: { sku: string; qty: number; variants?: Variant[] }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [n, setN] = useState(1);
  // Products with colours are managed per colour — default to the first colour, no "whole product".
  const [variantId, setVariantId] = useState(variants[0]?.id ?? "");
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  const selected = variants.find((v) => v.id === variantId);
  const currentQty = selected ? selected.qty : qty;
  const currentLabel = selected ? `${selected.color ?? selected.sku}` : "whole product";

  return (
    <form action={adjustStockAction} className="bg-white rounded-2xl p-5 shadow-card border border-sand">
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="font-medium text-ink">Adjust stock</h3>
        <span className="text-sm text-muted">{currentLabel}: <b className={currentQty <= 2 ? "text-rose" : "text-ink"}>{currentQty}</b> pcs</span>
      </div>
      <input type="hidden" name="sku" value={sku} />
      <input type="hidden" name="variant_id" value={variantId} />
      <input type="hidden" name="delta" value={sign * Math.max(1, Math.abs(n))} />

      <div className={`grid gap-3 items-end ${variants.length ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {variants.length > 0 && (
          <label className="text-xs text-muted">Apply to
            <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className={`${fld} w-full mt-1`}>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.color ?? v.sku} ({v.qty})</option>)}
            </select>
          </label>
        )}
        <div className="text-xs text-muted">
          Direction
          <div className="flex gap-1 mt-1">
            <button type="button" onClick={() => setSign(1)} className={`px-3 py-2 rounded-xl text-sm flex-1 ${sign === 1 ? "bg-emerald-mist text-emerald border border-emerald" : "border border-sand text-muted"}`}>Add</button>
            <button type="button" onClick={() => setSign(-1)} className={`px-3 py-2 rounded-xl text-sm flex-1 ${sign === -1 ? "bg-rose/10 text-rose border border-rose" : "border border-sand text-muted"}`}>Remove</button>
          </div>
        </div>
        <label className="text-xs text-muted">Quantity
          <QtyField value={n} onChange={setN} className={`${fld} w-full mt-1`} />
        </label>
        <label className="text-xs text-muted">Source / reason
          <select name="source" className={`${fld} w-full mt-1`}>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <input name="reason" placeholder="Optional note (e.g. bill #1234, supplier name)" className={`${fld} flex-1`} />
        <button className="btn-primary px-5 py-2.5 text-sm font-medium whitespace-nowrap">{sign === 1 ? "Add stock" : "Remove stock"}</button>
      </div>
    </form>
  );
}
