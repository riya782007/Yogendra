export const dynamic = "force-dynamic";
import { getStorefront } from "@/lib/supabase/queries";
import { liveOffer } from "@/lib/offers";
import { POSClient } from "@/components/admin/POSClient";

export const metadata = { title: "Owner Console · Billing (POS)" };

export default async function Billing() {
  const { products, formula } = await getStorefront({ includeWholesaleOnly: true });
  const list = products.map((p) => ({ sku: p.sku, name: p.name, price: liveOffer(p.base_wholesale, formula).price, category: p.category.name, qty: p.qty }));
  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Billing · Point of Sale</h1>
      <p className="text-sm text-muted mb-6">Ring up a counter sale. Stock and books update the instant you complete it.</p>
      <POSClient products={list} />
    </main>
  );
}
