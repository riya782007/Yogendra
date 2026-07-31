export const dynamic = "force-dynamic";
import { getCustomersDbCached, getPaymentMethods, getEmployees } from "@/lib/supabase/queries";
import { POSClient } from "@/components/admin/POSClient";

export const metadata = { title: "Owner Console · Billing (POS)" };

export default async function Billing() {
  // ROOT PERFORMANCE FIX: the catalogue is ~4.5k products / ~13k SKUs. We used to build every SKU row
  // here and ship them ALL to the browser, which made the counter take many seconds to open. We no
  // longer preload the catalogue at all — POSClient searches/scans live against the server
  // (posLookupAction handles exact SKU AND name search), so the page opens instantly and can still bill
  // ANY SKU, including drafts, out-of-stock (backorder) and wholesale-only lines.
  const [customers, methods, employees] = await Promise.all([
    getCustomersDbCached(),
    getPaymentMethods({ activeOnly: true }),
    getEmployees({ activeOnly: true }),
  ]);
  const custList = customers.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone ?? "", type: c.type ?? "retail", gstin: c.gstin ?? "" }));
  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Billing · Point of Sale</h1>
      <p className="text-sm text-muted mb-6">Ring up a counter sale. Stock and books update the instant you complete it.</p>
      <POSClient products={[]} customers={custList} methods={methods.map((m) => ({ id: m.id, name: m.name, kind: m.kind }))} employees={employees.map((e) => ({ id: e.id, name: e.name }))} />
    </main>
  );
}
