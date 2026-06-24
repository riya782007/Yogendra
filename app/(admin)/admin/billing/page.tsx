export const dynamic = "force-dynamic";
import { getStorefront } from "@/lib/supabase/queries";
import { POSClient } from "@/components/admin/POSClient";
import { resolvePrices, overridesOf } from "@/lib/pricing";

export const metadata = { title: "Owner Console · Billing (POS)" };

export default async function Billing() {
  // POS can bill anything in the catalogue — including unpublished drafts (#23) and wholesale-only lines.
  const { products, formula } = await getStorefront({ includeDrafts: true, includeWholesaleOnly: true });
  const list = products.map((p) => {
    const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
    // Both price lists, override-aware, so the counter can ring up at retail or wholesale (#16).
    return { sku: p.sku, name: p.name, price: ps.retailPrice, wholesale: ps.wholesaleRate, category: p.category.name, qty: p.qty };
  });
  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Billing · Point of Sale</h1>
      <p className="text-sm text-muted mb-6">Ring up a counter sale. Stock and books update the instant you complete it.</p>
      <POSClient products={list} />
    </main>
  );
}
