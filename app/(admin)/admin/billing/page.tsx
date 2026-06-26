export const dynamic = "force-dynamic";
import { getStorefront, getCustomersDb } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { POSClient } from "@/components/admin/POSClient";
import { resolvePrices, overridesOf } from "@/lib/pricing";

export const metadata = { title: "Owner Console · Billing (POS)" };

export default async function Billing() {
  const sb = supabaseServer();
  // POS can bill anything in the catalogue — including unpublished drafts (#23) and wholesale-only lines.
  const [{ products, formula }, customers, { data: variants }] = await Promise.all([
    getStorefront({ includeDrafts: true, includeWholesaleOnly: true }),
    getCustomersDb({}),
    sb.from("variants").select("sku,color,qty,product_id,wholesale_override,retail_override,mrp_override"),
  ]);
  // Variant SKUs (e.g. KPC64-MEH) are what's printed on the physical labels — so the counter
  // must scan/search them too. For products that HAVE variants we list each colour; products
  // without variants list the parent SKU. Either way price is override-aware (retail + wholesale).
  const varsByProduct = new Map<string, any[]>();
  for (const v of (variants ?? []) as any[]) {
    const a = varsByProduct.get(v.product_id) ?? [];
    a.push(v); varsByProduct.set(v.product_id, a);
  }
  const list: { sku: string; name: string; price: number; wholesale: number; category: string; qty: number }[] = [];
  for (const p of products as any[]) {
    const vs = varsByProduct.get(p.id) ?? [];
    if (vs.length) {
      for (const v of vs) {
        const ps = resolvePrices(p.base_wholesale, formula, overridesOf(v), overridesOf(p));
        list.push({ sku: v.sku, name: `${p.name}${v.color ? " · " + v.color : ""}`, price: ps.retailPrice, wholesale: ps.wholesaleRate, category: p.category.name, qty: v.qty ?? 0 });
      }
    } else {
      const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
      list.push({ sku: p.sku, name: p.name, price: ps.retailPrice, wholesale: ps.wholesaleRate, category: p.category.name, qty: p.qty });
    }
  }
  // Existing customers for the counter to pick from (#3).
  const custList = customers.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone ?? "", type: c.type ?? "retail", gstin: c.gstin ?? "" }));
  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Billing · Point of Sale</h1>
      <p className="text-sm text-muted mb-6">Ring up a counter sale. Stock and books update the instant you complete it.</p>
      <POSClient products={list} customers={custList} />
    </main>
  );
}
