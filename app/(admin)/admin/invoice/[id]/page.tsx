export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { PrintButton } from "@/components/admin/PrintButton";
import { UpiAmountQr } from "@/components/admin/UpiAmountQr";
import { CancelOrderButton } from "@/components/admin/CancelOrderButton";
import { EditBillPanel } from "@/components/admin/EditBillPanel";
import { BUSINESS, HSN_JEWELLERY, GST_RATE, gstSplit, gstSplitExclusive, stateCodeFromGstin, stateNameFromCode, bankHasDetails, amountInWords } from "@/lib/business";
import { getSession, can } from "@/lib/auth";
import { recordPaymentAction, setDocTypeAction, saveOrderNoteAction, setBillTypeAction, setGstModeAction } from "@/app/actions/payments";

export const metadata = { title: "Invoice" };

export default async function Invoice({ params }: { params: { id: string } }) {
  const data = await getOrder(params.id);
  // Returns recorded AGAINST this bill (credit notes + per-line movements) — surfaced right on the
  // bill so nobody accidentally records the same return twice or misses that one already happened.
  const sbRet = supabaseServer();
  const [{ data: retNotes }, { data: retMoves }] = await Promise.all([
    sbRet.from("returns").select("id,qty,amount,reason,created_at").eq("kind", "sales").eq("ref_order_id", params.id).order("created_at", { ascending: false }),
    sbRet.from("stock_adjustments").select("sku,delta,reason,created_at, variant:variants(color)").eq("kind", "return").eq("ref_id", params.id).order("created_at", { ascending: false }),
  ]);
  const returnsAgainst = ((retNotes as any[]) ?? []);
  const returnMoves = ((retMoves as any[]) ?? []);
  if (!data) notFound();
  const { order } = data;
  // Salesperson who rang up this bill — resolved by name so EVERY bill is attributed to a person
  // (owner: "if he made an employee, it must be mentioned on the bill"). Counter/POS bills always
  // carry one; online (storefront/wholesale) orders have none, so the line is simply omitted there.
  let soldBy: string | null = null;
  if ((order as any).sales_employee_id) {
    const { data: emp } = await supabaseServer().from("employees").select("name").eq("id", (order as any).sales_employee_id).maybeSingle();
    soldBy = (emp as any)?.name ?? null;
  }
  // #4/#35: list bill lines in A–Z SKU order so picking/checking is predictable.
  const items = [...data.items].sort((a: any, b: any) => String(a.variant?.sku ?? a.product?.sku ?? "").localeCompare(String(b.variant?.sku ?? b.product?.sku ?? "")));

  const isCash = order.bill_type === "cash";
  const isProforma = order.doc_type === "proforma";
  // GST Officer (billing.gst_only) may view only GST tax invoices — block cash memos. Owner exempt.
  const _gs = getSession();
  if (!_gs.isOwner && can(_gs, "billing.gst_only") && isCash) notFound();
  const total = order.total as number;
  const paid = order.amount_paid ?? 0;
  const buyerStateCode = order.buyer_state || stateCodeFromGstin(order.buyer_gstin);
  // GST mode: an ONLINE cart (retail / wholesale) already shows GST-INCLUSIVE prices — the customer
  // paid exactly what the cart showed, so the invoice must NOT add 3% again (owner: "cart me already
  // GST laga hua hai"). So online orders default to INCLUSIVE (GST is extracted from within the total).
  // The owner's manual POS counter bills stay EXCLUSIVE by default (he enters pre-tax rates and GST is
  // added on top). Either can be pinned per-bill via gst_mode.
  const gstMode = (order.gst_mode as "inclusive" | "exclusive" | null | undefined) ?? null;
  // Prices stored in this system ALREADY include GST — the rate the owner keys at the counter and the
  // price the cart shows both carry the 3% inside them (owner: "jisme GST added hai wo firse GST add kr
  // raha hai, do baar laga raha hai"). So EVERY channel defaults to INCLUSIVE: the invoice EXTRACTS the
  // CGST/SGST share from within the price instead of adding 3% on top (which was double-charging on POS
  // bills, e.g. ₹960 printing as ₹989). Exclusive is applied ONLY when the owner explicitly pins it for
  // a one-off bill where he keyed pre-tax rates.
  const gstExclusive = !isCash && gstMode === "exclusive";
  const g = gstExclusive ? gstSplitExclusive(total, buyerStateCode) : gstSplit(total, buyerStateCode);
  // Extra charges (Packing/Courier/Adjustment) are folded into the total so GST applies to them;
  // here we split them back out so the bill itemises them. Products portion = total − charges.
  const xPacking = (order.extra_packing as number) || 0;
  const xCourier = (order.extra_courier as number) || 0;
  const xAdjust = (order.extra_adjustment as number) || 0;
  const xCharges = xPacking + xCourier + xAdjust;
  const itemsTotal = total - xCharges;
  // What the customer actually owes: inclusive total (or pre-tax + GST when exclusive).
  const payable = isCash ? total : gstExclusive ? total + g.tax : total;
  const roundedTotal = Math.round(payable / 100) * 100;
  const roundOff = roundedTotal - payable;
  // Compare paid against the ROUNDED grand total the customer actually pays — so collecting the
  // shown amount settles the bill exactly (no 5–10 paise phantom balance from GST rounding).
  const balanceDue = Math.max(0, roundedTotal - paid);
  const payStatus = paid <= 0 ? "Unpaid" : paid >= roundedTotal ? "Paid" : "Partial";

  const docTitle = isCash ? "CASH MEMO" : isProforma ? "PROFORMA INVOICE" : "TAX INVOICE";
  const invNo = order.invoice_no || ((isCash ? "CM-" : "INV-") + String(order.id).slice(0, 8).toUpperCase());
  const date = new Date(order.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const qtyTotal = items.reduce((s: number, it: any) => s + it.qty, 0);
  // Default UPI for the scan-to-pay QR (exact bill amount).
  const { data: pmRows } = await supabaseServer().from("payment_methods").select("id,upi_id,name,kind,is_default,sort").eq("active", true).order("sort").order("name");
  const defUpi = ((pmRows as any[]) ?? []).filter((m) => m.upi_id).sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] ?? null;
  const payMethods = ((pmRows as any[]) ?? []);
  const defMethodId = (payMethods.find((m) => m.is_default) ?? payMethods[0])?.id ?? "";
  // WHICH account(s) the money for THIS bill actually landed in — read from the account ledger so the
  // settled-payment line names the real account (Cash / a UPI id / a bank), not a generic label.
  const nameById = new Map(payMethods.map((m: any) => [m.id, m.name]));
  const { data: payTxns } = await supabaseServer().from("payment_method_transactions").select("amount,method_id").eq("ref_id", order.id).eq("direction", "in");
  const paidAccounts = new Map<string, number>();
  for (const t of ((payTxns as any[]) ?? [])) { const nm = nameById.get(t.method_id) ?? "Other"; paidAccounts.set(nm, (paidAccounts.get(nm) ?? 0) + (t.amount ?? 0)); }
  const paidAccountLabel = [...paidAccounts.entries()].map(([nm, amt]) => `${nm} ${formatPaise(amt)}`).join(" · ");
  const session = getSession();
  const PAY_STYLE: Record<string, string> = { Paid: "bg-emerald-mist text-emerald-dark", Partial: "bg-gold/15 text-gold-dark", Unpaid: "bg-rose/10 text-rose" };

  const th = "py-2 px-2 text-xs font-semibold text-ink/70";
  const td = "py-2 px-2 align-top";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      {/* Print on A4 with COMPACT item rows so a many-SKU bill fits ~25+ items per page (owner:
          "1 page pe atleast 20-25 items aajaye"). Rows are tightened and never split across a page.
          Scoped to this route via a page-level @page so the barcode sheet is unaffected. */}
      <style dangerouslySetInnerHTML={{ __html: `@media print{
        @page{size:A4;margin:9mm}
        /* READABILITY FIRST (owner: "elderly ko chhota lagta hai — bada aur saaf karo"). Larger base
           type, roomier rows, and NO tiny 10-11px text anywhere on paper — every line is legible at
           arm's length. A4 still fits ~16-18 items per page; the header repeats and rows never split. */
        .print-area{font-size:14px !important;line-height:1.55 !important;padding:0 !important;box-shadow:none !important;border-radius:0 !important}
        .print-area .font-display{font-size:2rem !important}
        .print-area table{font-size:14px !important}
        .print-area table th{font-size:13px !important}
        .print-area table td,.print-area table th{padding-top:8px !important;padding-bottom:8px !important}
        /* SKU sits in its own column — decent, clearly legible size (not oversized), bold mono. */
        .print-area .bill-sku{font-size:14.5px !important;font-weight:700 !important}
        /* Raise the floor on all the small muted text (tax rows, terms, bank details, footer) so a
           document that used 10-11px on screen prints at a comfortable size. Substring match on the
           Tailwind arbitrary-size utilities means we lift them all without editing each element. */
        .print-area [class*="text-[10px]"]{font-size:12.5px !important}
        .print-area [class*="text-[11px]"]{font-size:13px !important}
        .print-area [class*="text-xs"]{font-size:13px !important}
        .print-area [class*="text-[13px]"]{font-size:14px !important}
        /* The grand total is what he and the customer look for first — make it stand out clearly. */
        .print-area .grand-total{font-size:18px !important;font-weight:700 !important}
        .print-area tr{page-break-inside:avoid}
        .print-area thead{display:table-header-group}
      }` }} />
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Link href="/admin/billing" className="text-sm text-emerald nav-link">← New sale</Link>
          <div className="flex items-center gap-2">
            {session.isOwner && <CancelOrderButton orderId={String(order.id)} cancelled={order.status === "cancelled"} />}
            <PrintButton />
          </div>
        </div>

        <div className="print-area bg-white rounded-2xl shadow-card p-5 sm:p-8 text-[13px]" id="invoice">
          {/* Title bar */}
          <div className="text-center pb-3 mb-3 border-b-2 border-ink/80 relative">
            <p className="text-[15px] font-bold tracking-wide text-ink">{docTitle}</p>
            {!isCash && !isProforma && <p className="text-[10px] text-muted">(Original for Recipient)</p>}
            {isProforma && <p className="text-[10px] text-muted">Not a tax invoice — for quotation/advance only.</p>}
            <span className={`absolute right-0 top-0 text-[11px] px-2 py-0.5 rounded-full ${PAY_STYLE[payStatus]}`}>{payStatus}</span>
          </div>

          {/* Seller + meta */}
          <div className="grid sm:grid-cols-2 gap-4 border border-sand rounded-lg overflow-hidden">
            <div className="p-4 border-b sm:border-b-0 sm:border-r border-sand">
              <p className="font-display text-2xl text-ink leading-none">{BUSINESS.brand}</p>
              {/* A cash memo is a non-GST retail bill — it carries only the trade name + contact,
                  NOT GSTIN / PAN / TIN / legal entity. Full seller identity shows on GST invoices only. */}
              {isCash ? (
                <>
                  <p className="text-xs text-muted mt-1">{BUSINESS.address}</p>
                  <p className="text-xs text-muted mt-1">{BUSINESS.phone}{BUSINESS.email ? <> · {BUSINESS.email}</> : null}</p>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted mt-0.5">{BUSINESS.legalName}</p>
                  <p className="text-xs text-muted mt-1">{BUSINESS.address}</p>
                  <p className="text-xs text-ink mt-1"><b>GSTIN:</b> {BUSINESS.gstin}</p>
                  <p className="text-xs text-muted"><b>PAN:</b> {BUSINESS.pan}{BUSINESS.tin ? <> · <b>TIN:</b> {BUSINESS.tin}</> : null} · State: {BUSINESS.stateName} ({BUSINESS.stateCode})</p>
                  <p className="text-xs text-muted">{BUSINESS.phone} · {BUSINESS.email}</p>
                </>
              )}
            </div>
            <div className="p-4 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted">Invoice No.</span><span className="font-medium text-ink">{invNo}</span></div>
              <div className="flex justify-between"><span className="text-muted">Date</span><span className="text-ink">{date}</span></div>
              <div className="flex justify-between"><span className="text-muted">Payment mode</span><span className="text-ink">{String(order.payment_mode || "—").toUpperCase()}</span></div>
              {soldBy && <div className="flex justify-between"><span className="text-muted">Sold by</span><span className="text-ink font-medium">{soldBy}</span></div>}
              <div className="flex justify-between"><span className="text-muted">Channel</span><span className="text-ink capitalize">{order.channel}</span></div>
              {!isCash && <div className="flex justify-between"><span className="text-muted">Place of supply</span><span className="text-ink">{stateNameFromCode(buyerStateCode || BUSINESS.stateCode)} ({buyerStateCode || BUSINESS.stateCode})</span></div>}
            </div>
          </div>

          {/* Buyer */}
          <div className="border border-t-0 border-sand rounded-b-lg p-4 -mt-px">
            <p className="text-[10px] uppercase tracking-wide text-muted mb-1">{isCash ? "Customer" : "Bill to / Buyer"}</p>
            <p className="text-ink font-medium">{order.customer_name || "Walk-in customer"}</p>
            {order.buyer_address && <p className="text-muted text-xs">{order.buyer_address}</p>}
            {order.customer_phone && <p className="text-muted text-xs">Ph: {order.customer_phone}</p>}
            {!isCash && order.buyer_gstin && <p className="text-xs text-ink mt-0.5"><b>GSTIN:</b> {order.buyer_gstin}</p>}
          </div>

          {/* Items */}
          <table className="w-full mt-4 border border-sand">
            <thead className="bg-cream border-b border-sand">
              <tr className="text-left">
                <th className={th}>#</th>
                <th className={th}>SKU · Colour</th>
                <th className={th}>Item</th>
                {!isCash && <th className={`${th} text-center`}>HSN</th>}
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>Disc</th>
                <th className={`${th} text-right`}>{gstExclusive ? "Taxable Value" : "Amount"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => {
                // Item lines ALWAYS show the owner's REGULAR rate exactly as stored (owner: "jo apna regular
                // rate hai wohi likha aaye, neeche GST jude jaise bill me hota hai"). We no longer divide the
                // rate down in inclusive mode — that was printing a ₹150 rate as ₹145.63. For an inclusive
                // bill the 3% GST lives INSIDE this rate and is broken out in the tax summary below; for an
                // exclusive bill the rate is pre-tax and GST is added below. Either way the line shows the
                // real rate the owner and customer recognise.
                const lineTaxable = it.line_total;
                const unit = it.unit_price;
                // Original (pre-discount) rate for the Rate column; Amount stays the discounted net.
                const origRaw = it.unit_mrp && it.unit_mrp > it.unit_price ? it.unit_mrp : it.unit_price;
                const origUnit = origRaw;
                const discPct = origUnit > unit ? Math.round((1 - unit / origUnit) * 100) : 0;
                return (
                  <tr key={i} className="border-b border-sand/60">
                    <td className={`${td} text-muted`}>{i + 1}</td>
                    {/* SKU has its OWN column with the colour — the field they rely on most. Name is secondary. */}
                    <td className={td}>
                      <span className="bill-sku font-mono font-bold text-[14px] text-ink block leading-tight whitespace-nowrap">{it.variant?.sku ?? it.product?.sku}</span>
                      {it.variant?.color && <span className="text-[12.5px] font-medium text-emerald-dark">{it.variant.color}</span>}
                    </td>
                    <td className={`${td} text-ink text-[13px] leading-snug`}>{it.product?.name}</td>
                    {!isCash && <td className={`${td} text-center text-muted`}>{HSN_JEWELLERY}</td>}
                    <td className={`${td} text-right`}>{it.qty}</td>
                    <td className={`${td} text-right ${discPct > 0 ? "text-muted line-through" : ""}`}>{formatPaise(origUnit)}</td>
                    <td className={`${td} text-right ${discPct > 0 ? "text-emerald-dark" : "text-muted"}`}>{discPct > 0 ? `${discPct}%` : "—"}</td>
                    <td className={`${td} text-right`}>{formatPaise(lineTaxable)}</td>
                  </tr>
                );
              })}
              <tr className="bg-cream/50 font-medium">
                <td className={td}></td><td className={td}></td><td className={`${td} text-ink`}>Total</td>{!isCash && <td className={td}></td>}
                <td className={`${td} text-right`}>{qtyTotal}</td><td className={td}></td><td className={td}></td>
                <td className={`${td} text-right`}>{formatPaise(itemsTotal)}</td>
              </tr>
            </tbody>
          </table>

          {/* Totals + words */}
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div className="text-xs">
              <p className="text-muted mb-1">Amount in words</p>
              <p className="text-ink font-medium">{amountInWords(roundedTotal)}</p>
              {!isCash && bankHasDetails() && (
                <div className="mt-4">
                  <p className="text-muted mb-1">Bank details</p>
                  <p className="text-ink">{BUSINESS.bank.name} · A/C {BUSINESS.bank.account}</p>
                  <p className="text-ink">{[BUSINESS.bank.ifsc && `IFSC ${BUSINESS.bank.ifsc}`, BUSINESS.bank.branch].filter(Boolean).join(" · ")}</p>
                </div>
              )}
              {/* Scan-to-pay UPI QR for the exact amount still due (hidden once fully paid). */}
              {balanceDue > 0 && defUpi?.upi_id && (
                <div className="mt-4">
                  <UpiAmountQr upiId={defUpi.upi_id} payeeName={defUpi.name} amountPaise={balanceDue} note={`Bill ${invNo}`} />
                </div>
              )}
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between text-muted"><span>{isCash ? "Sub-total" : gstExclusive ? "Taxable value (goods)" : "Sub-total (incl. GST)"}</span><span>{formatPaise(itemsTotal)}</span></div>
              {xPacking > 0 && <div className="flex justify-between text-muted"><span>Packing{!isCash && !gstExclusive ? " (incl. GST)" : ""}</span><span>{formatPaise(xPacking)}</span></div>}
              {xCourier > 0 && <div className="flex justify-between text-muted"><span>Courier{!isCash && !gstExclusive ? " (incl. GST)" : ""}</span><span>{formatPaise(xCourier)}</span></div>}
              {xAdjust !== 0 && <div className="flex justify-between text-muted"><span>Adjustment</span><span>{formatPaise(xAdjust)}</span></div>}
              {/* GST breakdown. INCLUSIVE (default): the 3% already sits INSIDE the amounts above, so it is
                  shown here as an "included" component and is NOT added again — the grand total stays equal to
                  the inclusive sub-total. EXCLUSIVE: the taxable value is pre-tax and CGST/SGST are genuinely
                  added on top to reach the grand total. */}
              {!isCash && (
                <div className="border-t border-sand/40 pt-1 mt-1">
                  {!gstExclusive && <p className="text-[11px] text-muted italic mb-0.5">GST included in the above —</p>}
                  <div className="flex justify-between text-muted"><span>Taxable value</span><span>{formatPaise(g.taxable)}</span></div>
                  {!g.interState ? (<>
                    <div className="flex justify-between text-muted"><span>CGST @{GST_RATE / 2}%</span><span>{formatPaise(g.cgst)}</span></div>
                    <div className="flex justify-between text-muted"><span>SGST @{GST_RATE / 2}%</span><span>{formatPaise(g.sgst)}</span></div>
                  </>) : (
                    <div className="flex justify-between text-muted"><span>IGST @{GST_RATE}%</span><span>{formatPaise(g.igst)}</span></div>
                  )}
                </div>
              )}
              {roundOff !== 0 && <div className="flex justify-between text-muted"><span>Round off</span><span>{formatPaise(roundOff)}</span></div>}
              <div className="grand-total flex justify-between font-semibold text-ink border-t border-sand pt-2 text-base"><span>Grand Total</span><span>{formatPaise(roundedTotal)}</span></div>
              <div className="flex justify-between text-emerald-dark"><span>Amount paid</span><span>{formatPaise(paid)}</span></div>
              {(order.pay_cash > 0 || order.pay_bank > 0) && (order.pay_cash > 0 && order.pay_bank > 0) && (
                <div className="flex justify-between text-[11px] text-muted"><span>— Cash {formatPaise(order.pay_cash)} · UPI/Bank {formatPaise(order.pay_bank)}</span><span /></div>
              )}
              {balanceDue > 0 && <div className="flex justify-between font-semibold text-rose"><span>Balance due</span><span>{formatPaise(balanceDue)}</span></div>}
            </div>
          </div>

          {/* HSN-wise tax summary (GST Rule 46) */}
          {!isCash && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[11px] border border-sand">
                <thead className="bg-cream text-muted">
                  <tr>
                    <th className="p-2 text-left">HSN/SAC</th>
                    <th className="p-2 text-right">Taxable Value</th>
                    {!g.interState ? (<>
                      <th className="p-2 text-right">CGST&nbsp;Rate</th><th className="p-2 text-right">CGST&nbsp;Amt</th>
                      <th className="p-2 text-right">SGST&nbsp;Rate</th><th className="p-2 text-right">SGST&nbsp;Amt</th>
                    </>) : (<>
                      <th className="p-2 text-right">IGST&nbsp;Rate</th><th className="p-2 text-right">IGST&nbsp;Amt</th>
                    </>)}
                    <th className="p-2 text-right">Total&nbsp;Tax</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-sand">
                    <td className="p-2">{HSN_JEWELLERY}</td>
                    <td className="p-2 text-right">{formatPaise(g.taxable)}</td>
                    {!g.interState ? (<>
                      <td className="p-2 text-right">{GST_RATE / 2}%</td><td className="p-2 text-right">{formatPaise(g.cgst)}</td>
                      <td className="p-2 text-right">{GST_RATE / 2}%</td><td className="p-2 text-right">{formatPaise(g.sgst)}</td>
                    </>) : (<>
                      <td className="p-2 text-right">{GST_RATE}%</td><td className="p-2 text-right">{formatPaise(g.igst)}</td>
                    </>)}
                    <td className="p-2 text-right">{formatPaise(g.tax)}</td>
                  </tr>
                  <tr className="border-t border-sand bg-cream/50 font-medium">
                    <td className="p-2 text-ink">Total</td>
                    <td className="p-2 text-right">{formatPaise(g.taxable)}</td>
                    {!g.interState ? (<>
                      <td className="p-2"></td><td className="p-2 text-right">{formatPaise(g.cgst)}</td>
                      <td className="p-2"></td><td className="p-2 text-right">{formatPaise(g.sgst)}</td>
                    </>) : (<>
                      <td className="p-2"></td><td className="p-2 text-right">{formatPaise(g.igst)}</td>
                    </>)}
                    <td className="p-2 text-right">{formatPaise(g.tax)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="text-[11px] text-muted mt-1">Tax Amount (in words): {amountInWords(g.tax)}</p>
            </div>
          )}

          {/* Terms + signature */}
          <div className="grid sm:grid-cols-2 gap-4 mt-6 pt-4 border-t border-sand">
            <div className="text-[11px] text-muted">
              <p className="font-medium text-ink/70 mb-1">Terms &amp; conditions</p>
              <ol className="list-decimal ml-4 space-y-0.5">
                {BUSINESS.terms.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            </div>
            <div className="text-right text-xs flex flex-col justify-end">
              <p className="text-muted">For <b className="text-ink">{isCash ? BUSINESS.brand : BUSINESS.legalName}</b></p>
              <div className="h-12" />
              <p className="text-ink border-t border-sand pt-1 inline-block ml-auto">Authorised Signatory</p>
            </div>
          </div>

          <p className="text-center text-[10px] text-muted mt-4">This is a computer-generated {docTitle.toLowerCase()} and does not require a physical signature.</p>
        </div>

        {/* Returns against this bill (screen-only, never printed) */}
        {returnsAgainst.length > 0 && (
          <div className="no-print bg-gold/5 border border-gold/40 rounded-2xl p-5 mt-5">
            <h2 className="font-medium text-gold-dark mb-1">↩ Returns recorded against this bill</h2>
            <p className="text-[11px] text-muted mb-2">Already returned — the return window for these pieces is closed. Credit notes include the bill&apos;s GST share.</p>
            <ul className="divide-y divide-gold/20 text-sm">
              {returnsAgainst.map((r: any) => (
                <li key={r.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span>
                  <span className="text-ink">{r.qty} pc{r.qty === 1 ? "" : "s"}</span>
                  {(r.amount ?? 0) > 0 && <span className="text-ink font-medium tabular-nums">credit {formatPaise(r.amount)}</span>}
                  {r.reason && <span className="text-muted truncate">— {r.reason}</span>}
                </li>
              ))}
            </ul>
            {returnMoves.length > 0 && (
              <p className="text-[11px] text-muted mt-2">
                Lines: {returnMoves.map((m: any) => `${m.sku}${m.variant?.color ? ` (${m.variant.color})` : ""} ×${m.delta}`).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Admin controls (never printed) */}
        {(can(session, "billing.sell") || can(session, "billing.gst")) && (
          <div className="no-print grid sm:grid-cols-2 gap-4 mt-5">
            {/* RECORD PAYMENT — the primary next step after a bill is generated & printed. The owner's
                workflow (his words): "generate invoice, print it, THEN record where & what payment was
                received and move forward." So this sits FIRST, full-width and highlighted, with the full
                balance pre-filled for one-click settle and a bank/UPI/cash account picker. It shows on any
                live bill that still has a balance (a freshly generated bill = full amount due); once fully
                recorded, the balance hits zero, the card disappears and the bill flips to Paid. */}
            {can(session, "billing.sell") && order.status !== "cancelled" && balanceDue > 0 && (
              <div className="sm:col-span-2 bg-emerald-mist/60 border-2 border-emerald/40 rounded-2xl p-5 shadow-card">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">💰</span>
                  <h2 className="font-medium text-emerald-dark text-lg">Payment received? Record it here</h2>
                </div>
                <p className="text-xs text-emerald-dark/80 mb-3">Invoice generated &amp; printed — now log what {order.customer_name || "the customer"} paid and into which account. Balance due <b>{formatPaise(balanceDue)}</b>.</p>
                {/* CREDIT / UDHAAR (owner: "credit ho to?") — a credit sale is simply a bill left unpaid or
                    part-paid: record only what was actually received (or nothing), and the rest stays on the
                    books as Balance due with the bill marked Unpaid/Partial. Nothing is forced. */}
                <p className="text-[11px] text-emerald-dark/70 mb-3 bg-white/60 rounded-lg px-2.5 py-1.5 border border-emerald/20">💳 <b>Udhaar / credit?</b> Jitna paisa aaya utna hi daalein (ya kuch nahi) — baaki apne aap <b>Balance due</b> me chala jayega aur bill <b>Unpaid/Partial</b> rahega. Baad me jab baaki paisa aaye tab dobara yahin record kar dein.</p>
                <form action={recordPaymentAction} className="flex flex-wrap items-end gap-3">
                  <input type="hidden" name="order_id" value={order.id} />
                  <label className="flex flex-col text-xs text-emerald-dark/80">Amount received (₹)
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-muted">₹</span>
                      <input name="amount" type="number" min={1} defaultValue={Math.round(balanceDue / 100)} className="rounded-xl border border-emerald/30 bg-white px-3 py-2 text-sm w-32 outline-none focus:border-emerald" />
                    </div>
                  </label>
                  <label className="flex flex-col text-xs text-emerald-dark/80">Received in (account)
                    <select name="method_id" defaultValue={defMethodId} className="mt-1 rounded-xl border border-emerald/30 bg-white px-3 py-2 text-sm outline-none focus:border-emerald" title="Which account received it? Kotak / SBI / HDFC / UPI / Cash">
                      {payMethods.length === 0
                        ? <option value="">Cash</option>
                        : payMethods.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                  <button className="btn-primary px-6 py-2.5 text-sm font-medium">✓ Record payment</button>
                </form>
                <p className="text-[11px] text-emerald-dark/70 mt-2">Full amount is pre-filled — for a part-payment just change the number. It posts against the chosen bank/UPI/cash account so your day-book stays split by account.</p>
              </div>
            )}
            {/* PAID CONFIRMATION — when the bill is fully settled there's nothing to record, so instead of a
                blank space we show a clear "payment recorded" confirmation. This makes the payment step
                VISIBLE on every generated bill (owner thought nothing changed because a fully-paid bill
                showed no payment box). Shows the split by account when both cash + bank were taken. */}
            {can(session, "billing.sell") && order.status !== "cancelled" && balanceDue <= 0 && paid > 0 && (
              <div className="sm:col-span-2 bg-emerald-mist/40 border border-emerald/30 rounded-2xl p-4 shadow-card flex items-center gap-3">
                <span className="text-lg">✓</span>
                <div>
                  <p className="font-medium text-emerald-dark text-sm">Payment recorded — bill settled</p>
                  <p className="text-[11px] text-emerald-dark/80">
                    {(() => {
                      // WHERE the money came in. Prefer the EXACT account(s) from the account ledger (e.g.
                      // "Kotak Bank Transfer ₹20,085"); else fall back to the cash/bank tender. Never show the
                      // stale payment_mode (which stays "pending" on an estimate-billed order → "via PENDING").
                      const bothSplit = order.pay_cash > 0 && order.pay_bank > 0;
                      const via = paidAccountLabel
                        ? paidAccountLabel
                        : bothSplit ? `Cash ${formatPaise(order.pay_cash)} · UPI/Bank ${formatPaise(order.pay_bank)}`
                        : order.pay_cash > 0 ? "Cash"
                        : order.pay_bank > 0 ? "UPI / Bank"
                        : (order.payment_mode && !["pending", "cod"].includes(String(order.payment_mode).toLowerCase())) ? String(order.payment_mode).toUpperCase()
                        : "";
                      const useDash = !!paidAccountLabel || bothSplit;
                      return <>{formatPaise(paid)} received{via ? (useDash ? ` — ${via}` : ` via ${via}`) : ""}. Bill is marked <b>Paid</b>.</>;
                    })()}
                  </p>
                </div>
              </div>
            )}
            {/* OTP-gated bill editing — fix a wrong qty / mis-scanned line without cancelling. Only on a
                live (non-cancelled) bill. */}
            {can(session, "billing.sell") && order.status !== "cancelled" && (
              <div className="sm:col-span-2">
                <EditBillPanel orderId={String(order.id)} />
              </div>
            )}
            {can(session, "billing.sell") && (
              <div className="bg-white rounded-2xl p-5 shadow-card sm:col-span-2">
                <h2 className="font-medium text-ink mb-1">Internal note <span className="text-xs text-muted font-normal">· staff only, never printed</span></h2>
                <form action={saveOrderNoteAction} className="flex flex-col sm:flex-row gap-2 mt-2">
                  <input type="hidden" name="order_id" value={order.id} />
                  <textarea name="admin_note" rows={2} defaultValue={order.admin_note ?? ""} placeholder="e.g. balance to be collected on delivery; discount given verbally; replacement piece pending…" className="flex-1 rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald" />
                  <button className="btn-primary px-4 py-2 text-sm font-medium self-start">Save note</button>
                </form>
              </div>
            )}
            {can(session, "billing.gst") && (
              <div className="bg-white rounded-2xl p-5 shadow-card">
                <h2 className="font-medium text-ink mb-1">Bill type</h2>
                <p className="text-xs text-muted mb-3">Currently a <b>{isCash ? "Cash Memo" : "GST Tax Invoice"}</b>. Customer changed their mind? Switch it.</p>
                <form action={setBillTypeAction}>
                  <input type="hidden" name="order_id" value={order.id} />
                  <input type="hidden" name="bill_type" value={isCash ? "gst" : "cash"} />
                  <button className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">{isCash ? "Convert to GST Tax Invoice →" : "Convert to Cash Memo →"}</button>
                </form>
                {isCash && !order.buyer_gstin && <p className="text-[11px] text-gold-dark mt-2">Tip: add the buyer's GSTIN for a complete B2B tax invoice.</p>}
              </div>
            )}
            {can(session, "billing.gst") && !isCash && (
              <div className="bg-white rounded-2xl p-5 shadow-card">
                <h2 className="font-medium text-ink mb-1">GST on this invoice</h2>
                <p className="text-xs text-muted mb-3">
                  Showing GST <b>{gstExclusive ? "added on top (exclusive)" : "included in the rate (inclusive)"}</b>
                  {gstMode ? " · pinned" : " · default"}. Your prices already include GST, so by default the invoice shows the tax <b>extracted from within the price</b> — it is never added a second time. Switch to exclusive only if this one bill&apos;s rates were keyed pre-tax.
                </p>
                <div className="flex flex-wrap gap-2">
                  <form action={setGstModeAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="gst_mode" value="exclusive" />
                    <button className={`px-3 py-1.5 rounded-full text-sm ${gstExclusive ? "bg-emerald text-white" : "bg-ink/5 text-ink hover:bg-ink/10"}`}>GST extra (exclusive)</button>
                  </form>
                  <form action={setGstModeAction}>
                    <input type="hidden" name="order_id" value={order.id} />
                    <input type="hidden" name="gst_mode" value="inclusive" />
                    <button className={`px-3 py-1.5 rounded-full text-sm ${!gstExclusive ? "bg-emerald text-white" : "bg-ink/5 text-ink hover:bg-ink/10"}`}>GST included</button>
                  </form>
                  {gstMode && (
                    <form action={setGstModeAction}>
                      <input type="hidden" name="order_id" value={order.id} />
                      <input type="hidden" name="gst_mode" value="auto" />
                      <button className="px-3 py-1.5 rounded-full text-sm text-muted hover:text-ink">Reset to auto</button>
                    </form>
                  )}
                </div>
                <p className="text-[11px] text-muted mt-2">Exclusive adds {GST_RATE}% on top of the rate; the grand total changes accordingly.</p>
              </div>
            )}
            {can(session, "billing.gst") && !isCash && (
              <div className="bg-white rounded-2xl p-5 shadow-card">
                <h2 className="font-medium text-ink mb-1">Document type</h2>
                <p className="text-xs text-muted mb-3">Currently a <b>{isProforma ? "Proforma" : "Tax Invoice"}</b>. {isProforma ? "Finalise to issue a numbered tax invoice." : ""}</p>
                <form action={setDocTypeAction}>
                  <input type="hidden" name="order_id" value={order.id} />
                  <input type="hidden" name="doc_type" value={isProforma ? "invoice" : "proforma"} />
                  <button className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">{isProforma ? "Finalise as Tax Invoice →" : "Mark as Proforma"}</button>
                </form>
              </div>
            )}
            {/* #39: nudge the customer for feedback on WhatsApp */}
            {can(session, "billing.sell") && order.customer_phone && (
              <div className="bg-white rounded-2xl p-5 shadow-card">
                <h2 className="font-medium text-ink mb-1">Ask for feedback</h2>
                <p className="text-xs text-muted mb-3">Nudge {order.customer_name || "the customer"} on WhatsApp to rate their experience.</p>
                <a href={`https://wa.me/91${String(order.customer_phone).replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Thank you for shopping with ${BUSINESS.brand}! 💛 We'd love your feedback: ${(process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "")}/feedback?ref=${invNo}`)}`} target="_blank" rel="noreferrer" className="inline-block px-4 py-2 rounded-full bg-[#25D366] text-white text-sm font-medium">Request on WhatsApp →</a>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
