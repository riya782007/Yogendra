"use client";
import { openAbandonedCartsPdf, type PdfCart } from "@/lib/abandonedCartPdf";

/** Download ALL abandoned carts as one clean PDF — each cart its own block with the customer's
 *  name/phone/city, channel, every item's thumbnail + SKU + colour + qty + unit price + line total,
 *  the cart total and when it was abandoned. (Print → Save as PDF.) */
export function AbandonedCartsPdfButton({ carts, imgMap }: { carts: PdfCart[]; imgMap?: Record<string, string> }) {
  return (
    <button onClick={() => openAbandonedCartsPdf(carts, { imgMap, title: "Abandoned Carts" })}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist">
      ⬇ Download all as PDF
    </button>
  );
}
