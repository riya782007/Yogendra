"use client";
import { useState } from "react";
import { adjustStockAction } from "@/app/actions/stock";
import { QtyField } from "@/components/admin/QtyField";

const SOURCES = [
  "Returned from cart (in-store)",
  "Customer cancelled",
  "Found / recount",
  "Sample returned",
  "Damaged — removed",
  "Correction",
  "Other",
];

export function StockAdjust() {
  const [open, setOpen] = useState(false);
  const [sign, setSign] = useState<1 | -1>(1);
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";

  return (
    <div className="mb-4">
      <button onClick={() => setOpen((o) => !o)} className="px-4 py-2 rounded-xl border border-emerald text-emerald text-sm hover:bg-emerald-mist transition-colors">
        {open ? "× Close" : "± Adjust stock"}
      </button>
      {open && (
        <form action={adjustStockAction} className="mt-3 bg-white rounded-2xl p-4 shadow-card border border-sand grid sm:grid-cols-5 gap-3 items-end">
          <label className="text-xs text-muted sm:col-span-1">SKU<input name="sku" placeholder="BD1000" className={`${fld} w-full mt-1`} required /></label>
          <div className="text-xs text-muted">
            Direction
            <div className="flex gap-1 mt-1">
              <button type="button" onClick={() => setSign(1)} className={`px-3 py-2 rounded-xl text-sm flex-1 ${sign === 1 ? "bg-emerald-mist text-emerald border border-emerald" : "border border-sand text-muted"}`}>Add</button>
              <button type="button" onClick={() => setSign(-1)} className={`px-3 py-2 rounded-xl text-sm flex-1 ${sign === -1 ? "bg-rose/10 text-rose border border-rose" : "border border-sand text-muted"}`}>Remove</button>
            </div>
          </div>
          <label className="text-xs text-muted">Quantity<QtyInput sign={sign} /></label>
          <label className="text-xs text-muted">Source / reason
            <select name="source" className={`${fld} w-full mt-1`}>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
          </label>
          <button className="btn-primary px-5 py-2.5 text-sm font-medium">Apply</button>
          <input name="reason" placeholder="Optional note (e.g. customer short on cash)" className={`${fld} sm:col-span-5`} />
        </form>
      )}
    </div>
  );
}

function QtyInput({ sign }: { sign: 1 | -1 }) {
  const [n, setN] = useState(1);
  return (
    <>
      <input type="hidden" name="delta" value={sign * Math.max(1, Math.abs(n))} />
      <QtyField value={n} onChange={setN} className="rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald w-full mt-1" />
    </>
  );
}
