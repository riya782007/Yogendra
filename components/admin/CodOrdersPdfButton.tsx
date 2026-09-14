"use client";
import { useState } from "react";
import { openCodOrdersPdf } from "@/lib/codOrdersPdf";
import { fetchCodOrdersPdfAction } from "@/app/actions/billing";

async function download(ids: string[], title: string) {
  const r = await fetchCodOrdersPdfAction(ids);
  if (!r.ok || !r.orders?.length) {
    alert(r.error ?? "Couldn't build the PDF.");
    return;
  }
  openCodOrdersPdf(r.orders, { imgMap: r.imgMap, title });
}

/** Download ALL held COD orders as one PDF — photos, SKU, colour, qty, rates, ship-to, collect amount. */
export function CodOrdersPdfButton({ orderIds }: { orderIds: string[] }) {
  const [busy, setBusy] = useState(false);
  if (!orderIds.length) return null;
  return (
    <button type="button" disabled={busy}
      onClick={async () => { setBusy(true); try { await download(orderIds, "COD Orders"); } finally { setBusy(false); } }}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist disabled:opacity-50">
      {busy ? "Preparing PDF…" : "⬇ Download all as PDF"}
    </button>
  );
}

/** One COD order as a PDF (same contents as abandoned-cart PDFs, plus invoice + delivery address). */
export function CodOrderPdfButton({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" disabled={busy}
      onClick={async () => { setBusy(true); try { await download([orderId], "COD Order"); } finally { setBusy(false); } }}
      title="Download this COD order as a PDF (with photos)"
      className="px-3 py-1 rounded-full border border-emerald text-emerald-dark text-[11px] hover:bg-emerald-mist/40 whitespace-nowrap disabled:opacity-50">
      {busy ? "…" : "⬇ PDF"}
    </button>
  );
}
