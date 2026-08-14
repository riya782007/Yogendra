export const dynamic = "force-dynamic";
/**
 * Debit note / credit note for a recorded return — printable and WhatsApp-shareable.
 * Purchase returns (bill-linked or without a bill) print as a DEBIT NOTE for the supplier.
 * Sales returns print as a CREDIT NOTE. Recording paths are unchanged; this is the document.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getReturnNote } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { PrintButton } from "@/components/admin/PrintButton";
import { BUSINESS, HSN_JEWELLERY, GST_RATE, gstSplit, amountInWords } from "@/lib/business";
import { SITE } from "@/lib/siteUrl";

export const metadata = { title: "Return note" };

function waDigits(phone?: string | null): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return "91" + d;
  if (d.length >= 11 && d.length <= 15) return d;
  return "";
}

export default async function ReturnNotePage({ params }: { params: { id: string } }) {
  const data = await getReturnNote(params.id);
  if (!data) notFound();
  const { ret, billRef, billHref, supplier, lines } = data;
  const isPurchase = ret.kind === "purchase";
  const docTitle = isPurchase ? "DEBIT NOTE" : "CREDIT NOTE";
  const docNo = (isPurchase ? "DN-" : "CN-") + String(ret.id).slice(0, 8).toUpperCase();
  const date = new Date(ret.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const partyName = supplier?.name || ret.party || (isPurchase ? "Supplier" : "Customer");
  const lineSum = lines.reduce((s, l) => s + l.lineTotal, 0);
  const total = lineSum > 0 ? lineSum : (ret.amount ?? 0);
  const g = total > 0 ? gstSplit(total) : null;
  const sorted = [...lines].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }));

  const waBody = [
    `${BUSINESS.brand} — ${docTitle} ${docNo}`,
    `Date: ${date}`,
    `Party: ${partyName}`,
    billRef ? `Against bill: ${billRef}` : "Against: no original bill (open return)",
    "",
    ...sorted.map((l) => `${l.sku}${l.color ? ` (${l.color})` : ""} × ${l.qty}${l.unitCost ? ` @ ${formatPaise(l.unitCost)} = ${formatPaise(l.lineTotal)}` : ""}`),
    "",
    `Total qty: ${ret.qty}`,
    total > 0 ? `Amount: ${formatPaise(total)}` : "",
    ret.reason ? `Reason: ${ret.reason}` : "",
    "",
    `${BUSINESS.legalName}`,
    `GSTIN ${BUSINESS.gstin}`,
    `Note: ${SITE}/admin/returns/${ret.id}`,
  ].filter((x) => x !== "").join("\n");
  const phone = waDigits(supplier?.phone);
  const waHref = `https://wa.me/${phone}?text=${encodeURIComponent(waBody)}`;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: `@media print{
        @page{size:A4;margin:9mm}
        .print-area{font-size:14px !important;line-height:1.55 !important;padding:0 !important;box-shadow:none !important;border-radius:0 !important}
        .print-area .font-display{font-size:2rem !important}
        .print-area table{font-size:14px !important}
        .print-area table td,.print-area table th{padding-top:8px !important;padding-bottom:8px !important}
        .print-area .bill-sku{font-size:14.5px !important;font-weight:700 !important}
        .print-area [class*="text-[10px]"]{font-size:12.5px !important}
        .print-area [class*="text-[11px]"]{font-size:13px !important}
        .print-area [class*="text-xs"]{font-size:13px !important}
        .print-area .grand-total{font-size:18px !important;font-weight:700 !important}
        .print-area tr{page-break-inside:avoid}
        .print-area thead{display:table-header-group}
      }` }} />
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4 no-print">
          <Link href="/admin/returns" className="text-sm text-emerald nav-link">← Returns register</Link>
          <div className="flex items-center gap-2">
            <a href={waHref} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-full bg-[#25D366] text-white text-sm font-medium">
              {phone ? "Share on WhatsApp →" : "Share on WhatsApp (pick chat) →"}
            </a>
            <PrintButton />
          </div>
        </div>

        <div className="print-area bg-white rounded-2xl shadow-card p-5 sm:p-8 text-[13px]" id="return-note">
          <div className="text-center pb-3 mb-3 border-b-2 border-ink/80">
            <p className="text-[15px] font-bold tracking-wide text-ink">{docTitle}</p>
            <p className="text-[10px] text-muted">
              {isPurchase ? "Goods returned to supplier — original for recipient" : "Goods received back from customer"}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 border border-sand rounded-lg overflow-hidden">
            <div className="p-4 border-b sm:border-b-0 sm:border-r border-sand">
              <p className="font-display text-2xl text-ink leading-none">{BUSINESS.brand}</p>
              <p className="text-xs text-muted mt-0.5">{BUSINESS.legalName}</p>
              <p className="text-xs text-muted mt-1">{BUSINESS.address}</p>
              <p className="text-xs text-ink mt-1"><b>GSTIN:</b> {BUSINESS.gstin}</p>
              <p className="text-xs text-muted"><b>PAN:</b> {BUSINESS.pan} · State: {BUSINESS.stateName} ({BUSINESS.stateCode})</p>
              <p className="text-xs text-muted">{BUSINESS.phone} · {BUSINESS.email}</p>
            </div>
            <div className="p-4 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted">Note No.</span><span className="font-medium text-ink">{docNo}</span></div>
              <div className="flex justify-between"><span className="text-muted">Date</span><span className="text-ink">{date}</span></div>
              <div className="flex justify-between"><span className="text-muted">Against bill</span><span className="text-ink">{billRef ?? "— (open return)"}</span></div>
              <div className="flex justify-between"><span className="text-muted">Qty returned</span><span className="text-ink">{ret.qty} pc{ret.qty === 1 ? "" : "s"}</span></div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 border border-sand rounded-lg overflow-hidden mt-4">
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-wide text-muted mb-1">{isPurchase ? "Supplier (debit)" : "Customer (credit)"}</p>
              <p className="font-medium text-ink">{partyName}</p>
              {supplier?.gstin && <p className="text-xs text-ink mt-0.5"><b>GSTIN:</b> {supplier.gstin}</p>}
              {(supplier?.address || supplier?.city) && <p className="text-xs text-muted">{[supplier.address, supplier.city].filter(Boolean).join(", ")}</p>}
              {supplier?.phone && <p className="text-xs text-muted">{supplier.phone}</p>}
            </div>
            <div className="p-4 text-xs">
              {ret.reason && <p><span className="text-muted">Reason: </span><span className="text-ink">{ret.reason}</span></p>}
              <p className="text-muted mt-2">HSN {HSN_JEWELLERY} · Imitation jewellery · GST {GST_RATE}%</p>
            </div>
          </div>

          <table className="w-full mt-4 text-sm">
            <thead className="bg-cream text-muted text-left">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">SKU</th>
                <th className="p-2">Description</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2 text-right">Rate</th>
                <th className="p-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={6} className="p-3 text-muted">No line items linked — header qty {ret.qty}{total ? ` · ${formatPaise(total)}` : ""}.</td></tr>
              )}
              {sorted.map((l, i) => (
                <tr key={i} className="border-t border-sand/60">
                  <td className="p-2 text-muted">{i + 1}</td>
                  <td className="p-2 font-mono bill-sku">{l.sku}</td>
                  <td className="p-2">{l.name}{l.color ? <span className="text-muted"> · {l.color}</span> : ""}</td>
                  <td className="p-2 text-right tabular-nums">{l.qty}</td>
                  <td className="p-2 text-right tabular-nums">{l.unitCost ? formatPaise(l.unitCost) : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{l.lineTotal ? formatPaise(l.lineTotal) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs text-sm space-y-1">
              {g && (
                <>
                  <div className="flex justify-between"><span className="text-muted">Taxable value</span><span>{formatPaise(g.taxable)}</span></div>
                  {g.cgst > 0 && <div className="flex justify-between"><span className="text-muted">CGST {GST_RATE / 2}%</span><span>{formatPaise(g.cgst)}</span></div>}
                  {g.sgst > 0 && <div className="flex justify-between"><span className="text-muted">SGST {GST_RATE / 2}%</span><span>{formatPaise(g.sgst)}</span></div>}
                  {g.igst > 0 && <div className="flex justify-between"><span className="text-muted">IGST {GST_RATE}%</span><span>{formatPaise(g.igst)}</span></div>}
                </>
              )}
              <div className="flex justify-between border-t border-ink/40 pt-2 grand-total">
                <span>Total</span><span>{total > 0 ? formatPaise(total) : "—"}</span>
              </div>
              {total > 0 && <p className="text-[11px] text-muted">{amountInWords(total)}</p>}
            </div>
          </div>

          <p className="text-[11px] text-muted mt-6">
            This {docTitle.toLowerCase()} is issued for goods returned{isPurchase ? " to the supplier" : " by the customer"}.
            Amounts are in Indian Rupees. Subject to Delhi jurisdiction.
          </p>
        </div>

        {billHref && billRef && billHref !== `/admin/returns/${ret.id}` && (
          <p className="no-print text-xs text-muted mt-3">Original document: <Link href={billHref} className="text-emerald nav-link">{billRef} ↗</Link></p>
        )}
      </div>
    </main>
  );
}
