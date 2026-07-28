export const dynamic = "force-dynamic";
import { getEstimates, getStorefrontCached, getCustomersDbCached, getBillingVariants } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { EstimateClient } from "@/components/admin/EstimateClient";
import { EstimatesTable } from "@/components/admin/EstimatesTable";

export const metadata = { title: "Owner Console · Estimates" };

export default async function Estimates() {
  // Heavy catalogue reads are result-cached (getStorefrontCached / getBillingVariants) so this page
  // opens fast instead of re-reading ~25k rows on every visit; changes refresh via revalidateTag.
  // The estimates are loaded ONCE and all tab-switching / search / sort happens CLIENT-side in
  // EstimatesTable — so tabs are instant (the old server-navigation tabs re-ran every heavy query on
  // each click, which made switching feel slow).
  const [{ products, formula }, estimates, customers, variants] = await Promise.all([
    getStorefrontCached({ includeDrafts: true, includeWholesaleOnly: true }),
    getEstimates({}),
    getCustomersDbCached(),
    getBillingVariants(),
  ]);
  // Expand each design into its colour VARIANTS (variant SKUs are what get billed), so the estimate
  // search shows the exact colour — e.g. "Rajwada Necklace · Green (KN132-GREEN)" — not just the parent.
  const varsByProduct = new Map<string, any[]>();
  for (const v of ((variants ?? []) as any[])) { const a = varsByProduct.get(v.product_id) ?? []; a.push(v); varsByProduct.set(v.product_id, a); }
  const list: { sku: string; name: string; price: number; wholesale: number; parentSku?: string; parentName?: string }[] = [];
  for (const p of products as any[]) {
    const vs = varsByProduct.get(p.id) ?? [];
    if (vs.length) {
      for (const v of vs) {
        const ps = resolvePrices(p.base_wholesale, formula, overridesOf(v), overridesOf(p));
        list.push({ sku: v.sku, name: `${p.name}${v.color ? " · " + v.color : ""}`, price: ps.retailPrice, wholesale: ps.wholesaleRate, parentSku: p.sku, parentName: p.name });
      }
    } else {
      const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
      list.push({ sku: p.sku, name: p.name, price: ps.retailPrice, wholesale: ps.wholesaleRate });
    }
  }
  const custList = customers.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone ?? "", type: c.type ?? "retail", gstin: c.gstin ?? "" }));

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Estimates &amp; Quotations</h1>
      <p className="text-sm text-muted mb-6">Quote now; bill only when the customer confirms. Each estimate can be held, billed with GST, billed as a cash memo, or denied.</p>
      <EstimateClient products={list} customers={custList} />
      <EstimatesTable estimates={estimates as any} />
    </main>
  );
}
