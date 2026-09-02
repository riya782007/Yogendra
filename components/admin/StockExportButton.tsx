"use client";
import { useMemo, useState } from "react";
import { exportStockCsvAction } from "@/app/actions/exportStock";

type Category = { id: string; name: string };
type Subcategory = { id: string; name: string; category_id: string };

/** Download live stock for the whole catalogue or a selected category/subcategory. */
export function StockExportButton({ className = "", categories, subcategories }: { className?: string; categories: Category[]; subcategories: Subcategory[] }) {
  const [busy, setBusy] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const availableSubcategories = useMemo(() => subcategories.filter((s) => !categoryId || s.category_id === categoryId), [categoryId, subcategories]);

  async function go() {
    setBusy(true);
    const r = await exportStockCsvAction({ categoryId: categoryId || undefined, subcategoryId: subcategoryId || undefined });
    setBusy(false);
    if (!r.ok || !r.csv) { alert(r.error ?? "Couldn't build the export — try again."); return; }
    const blob = new Blob([r.csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const suffix = subcategoryId ? "subcategory" : categoryId ? "category" : "all";
    a.download = `blythediva-stock-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select aria-label="Stock export category" value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(""); }} className="rounded-full border border-emerald/50 bg-white px-3 py-2 text-sm text-ink">
        <option value="">All categories</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <select aria-label="Stock export subcategory" value={subcategoryId} onChange={(e) => setSubcategoryId(e.target.value)} className="rounded-full border border-emerald/50 bg-white px-3 py-2 text-sm text-ink">
        <option value="">All subcategories</option>
        {availableSubcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button onClick={go} disabled={busy} className={className || "inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist disabled:opacity-50"}>
        {busy ? "Preparing…" : "Download stock (Excel)"}
      </button>
    </div>
  );
}
