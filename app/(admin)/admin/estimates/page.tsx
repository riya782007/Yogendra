export const dynamic = "force-dynamic";
import { getEstimates, getCustomersDbCached } from "@/lib/supabase/queries";
import { EstimateClient } from "@/components/admin/EstimateClient";
import { EstimatesTable } from "@/components/admin/EstimatesTable";

export const metadata = { title: "Owner Console · Estimates" };

export default async function Estimates({ searchParams }: { searchParams: { holderror?: string } }) {
  const holdError = searchParams?.holderror?.trim();
  // ROOT PERFORMANCE FIX: the catalogue is ~4.5k products / ~13k SKUs. Previously we expanded every SKU
  // here and shipped them ALL to the browser, so the page took many seconds to open. We no longer
  // preload the catalogue — EstimateClient searches/scans live against the server (posLookupAction),
  // so the page opens instantly and can still quote ANY SKU. Estimates load once; the table filters
  // client-side.
  const [estimates, customers] = await Promise.all([
    getEstimates({}),
    getCustomersDbCached(),
  ]);
  const custList = customers.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone ?? "", type: c.type ?? "retail", gstin: c.gstin ?? "" }));

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Estimates &amp; Quotations</h1>
      <p className="text-sm text-muted mb-6">Quote now; bill only when the customer confirms. Holding an estimate <b>reserves its stock</b> for the customer (set aside, not sellable) without billing — bill it when they collect, and any pieces they don&apos;t take return to stock.</p>
      {holdError && <div className="mb-5 rounded-xl border border-rose/40 bg-rose/5 px-4 py-3 text-sm text-rose">Couldn&apos;t hold this estimate — {holdError}</div>}
      <EstimateClient products={[]} customers={custList} />
      <EstimatesTable estimates={estimates as any} />
    </main>
  );
}
