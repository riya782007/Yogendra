export const dynamic = "force-dynamic";
import { getLabelItems } from "@/lib/supabase/queries";
import { BarcodeSheet } from "@/components/admin/BarcodeSheet";

export const metadata = { title: "Owner Console · Barcodes" };

export default async function Barcodes({ searchParams }: { searchParams?: { sku?: string; skus?: string } }) {
  // Products AND every colour/size variant — each with its own SKU + price (Pillar 11).
  const list = await getLabelItems();
  // Deep link: `?sku=ABC` for one design, `?skus=A,B,C` for a batch. DIVA uses this to act on
  // "in teeno ke labels nikal do" — it resolves the codes and sends the owner here with the sheet
  // already queued, instead of opening an empty page he has to retype into. A design with colours
  // expands to one label per colour on the other side (see BarcodeSheet).
  const initialSkus = [
    ...(String(searchParams?.sku ?? "").trim() ? [String(searchParams?.sku).trim()] : []),
    ...String(searchParams?.skus ?? "").split(","),
  ].map((s) => s.trim()).filter(Boolean);
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="no-print">
        <h1 className="font-display text-4xl text-ink mb-1">Barcode Labels</h1>
        <p className="text-sm text-muted mb-6">Generate scannable Code-128 labels for any product or colour variant — search a SKU, set how many labels each, and print a sheet for your tag gun or label printer.</p>
      </div>
      <BarcodeSheet products={list} initialSkus={initialSkus} />
    </main>
  );
}
