"use client";
import { openCodOrdersPdf, type PdfCodOrder } from "@/lib/codOrdersPdf";

/** Download ALL held COD orders as one PDF — photos, SKU, colour, qty, rates, ship-to, collect amount. */
export function CodOrdersPdfButton({ orders, imgMap }: { orders: PdfCodOrder[]; imgMap?: Record<string, string> }) {
  if (!orders.length) return null;
  return (
    <button type="button" onClick={() => openCodOrdersPdf(orders, { imgMap, title: "COD Orders" })}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist">
      ⬇ Download all as PDF
    </button>
  );
}

/** One COD order as a PDF (same contents as abandoned-cart PDFs, plus invoice + delivery address). */
export function CodOrderPdfButton({ order, imgMap }: { order: PdfCodOrder; imgMap?: Record<string, string> }) {
  return (
    <button type="button"
      onClick={() => openCodOrdersPdf([order], { imgMap, title: "COD Order" })}
      title="Download this COD order as a PDF (with photos)"
      className="px-3 py-1 rounded-full border border-emerald text-emerald-dark text-[11px] hover:bg-emerald-mist/40 whitespace-nowrap">
      ⬇ PDF
    </button>
  );
}
