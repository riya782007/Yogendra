"use client";
import { useMemo, useState } from "react";
import { exportStockCsvAction } from "@/app/actions/exportStock";

type Category = { id: string; name: string; subcategories: { id: string; name: string }[] };

/** Exports live variant stock for the full catalogue or a selected category/subcategory as Excel-ready CSV. */
export function StockExportButton({ categories, className = "" }: { categories: Category[]; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const subcategories = useMemo(() => categories.find((category) => category.id === categoryId)?.subcategories ?? [], [categories, categoryId]);

  async function go() {
    setBusy(true);
    const r = await exportStockCsvAction({ categoryId: categoryId || undefined, subcategoryId: subcategoryId || undefined });
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
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select aria-label="Export category" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setSubcategoryId(""); }} className="rounded-full border border-sand bg-white px-3 py-2 text-sm text-ink">
        <option value="">All categories</option>
        {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
      <select aria-label="Export subcategory" value={subcategoryId} onChange={(event) => setSubcategoryId(event.target.value)} disabled={!categoryId || subcategories.length === 0} className="rounded-full border border-sand bg-white px-3 py-2 text-sm text-ink disabled:opacity-50">
        <option value="">All subcategories</option>
        {subcategories.map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>)}
      </select>
      <button onClick={go} disabled={busy}
        className={className || "inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist disabled:opacity-50"}>
        {busy ? "Preparing…" : "Download stock (Excel)"}
      </button>
    </div>
  );
}
