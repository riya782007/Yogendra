export const dynamic = "force-dynamic";
import { getStorefront } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { BarcodeSheet } from "@/components/admin/BarcodeSheet";

export const metadata = { title: "Owner Console · Barcodes" };

export default async function Barcodes() {
  const { products, formula } = await getStorefront({ includeDrafts: true, includeWholesaleOnly: true });
  const list = products.map((p) => ({ sku: p.sku, name: p.name, price: liveOffer(p.base_wholesale, formula).price }));
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="no-print">
        <h1 className="font-display text-4xl text-ink mb-1">Barcode Labels</h1>
        <p className="text-sm text-muted mb-6">Generate scannable Code-128 labels for any SKU — pick products, set how many labels each, and print a sheet for your tag gun or label printer.</p>
      </div>
      <BarcodeSheet products={list} />
    </main>
  );
}
