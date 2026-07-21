"use client";
import { useState } from "react";
import { exportStockCsvAction } from "@/app/actions/exportStock";

/** One-click full-stock export (SKU + live stock) → downloads a CSV that opens straight in Excel. */
export function StockExportButton({ className = "" }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    const r = await exportStockCsvAction();
    setBusy(false);
    if (!r.ok || !r.csv) { alert(r.error ?? "Couldn't build the export — try again."); return; }
    const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `blythediva-stock-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  return (
    <button onClick={go} disabled={busy}
      className={className || "inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist disabled:opacity-50"}>
      {busy ? "Preparing…" : "⬇ Download stock (Excel)"}
    </button>
  );
}
