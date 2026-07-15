export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { PrintButton } from "@/components/admin/PrintButton";
import { UpiAmountQr } from "@/components/admin/UpiAmountQr";
import { CancelOrderButton } from "@/components/admin/CancelOrderButton";
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
  // GST TAX INVOICE is EXCLUSIVE by default: the rate is pre-tax and CGST/SGST is added on top,
  // so Grand Total = taxable + GST. The POS collects this tax-inclusive Grand Total (it adds the
  // GST at billing time), so amount paid matches and there is no phantom balance. The owner can
  // still pin a specific bill to inclusive via gst_mode = 'inclusive'.
  const gstMode = (order.gst_mode as "inclusive" | "exclusive" | null | undefined) ?? null;
  const gstExclusive = !isCash && (gstMode ? gstMode === "exclusive" : true);
  const g = gstExclusive ? gstSplitExclusive(total, buyerStateCode) : gstSplit(total, buyerStateCode);
  // Extra charges (Packing/Courier/Adjustment) are folded into the total so GST applies to them;
  // here we split them back out so the bill itemises them. Products portion = total − charges.
  const xPacking = (order.extra_packing as number) || 0;
  const xCourier = (order.extra_courier as number) || 0;
  const xAdjust = (order.extra_adjustment as number) || 0;
  const xCharges = xPacking + xCourier + xAdjust;
  const itemsTotal = total - xCharges;
  const itemsTaxable = (isCash || gstExclusive) ? itemsTotal : Math.round(itemsTotal / (1 + GST_RATE / 100));
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
  const { data: pmRows } = await supabaseServer().from("payment_methods").select("upi_id,name,is_default").eq("active", true);
  const defUpi = ((pmRows as any[]) ?? []).filter((m) => m.upi_id).sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] ?? null;
  const session = getSession();
  const PAY_STYLE: Record<string, string> = { Paid: "bg-emerald-mist text-emerald-dark", Partial: "bg-gold/15 text-gold-dark", Unpaid: "bg-rose/10 text-rose" };

  const th = "py-2 px-2 text-xs font-semibold text-ink/70";
  const td = "py-2 px-2 align-top";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      {/* #1 (Meeting 2): print invoices on A5 — better paper use for many-SKU orders. Scoped
          to this route via a page-level @page so the barcode sheet (A4) is unaffected. */}
      <style dangerouslySetInnerHTML={{ __html: "@media print{@page{size:A5;margin:6mm}.print-area{font-size:11px}.print-area .font-display{font-size:1.25rem}}" }} />
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
                <th className={th}>Description</th>
                {!isCash && <th className={`${th} text-center`}>HSN</th>}
                <th className={`${th} text-right`}>Qty</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>Disc</th>
                <th className={`${th} text-right`}>{isCash ? "Amount" : "Taxable Value"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => {
                const lineTaxable = (isCash || gstExclusive) ? it.line_total : Math.round(it.line_total / (1 + GST_RATE / 100));
                const unit = (isCash || gstExclusive) ? it.unit_price : Math.round(it.unit_price / (1 + GST_RATE / 100));
                // Original (pre-discount) rate for the Rate column; Amount stays the discounted net.
                const origRaw = it.unit_mrp && it.unit_mrp > it.unit_price ? it.unit_mrp : it.unit_price;
                const origUnit = (isCash || gstExclusive) ? origRaw : Math.round(origRaw / (1 + GST_RATE / 100));
                const discPct = origUnit > unit ? Math.round((1 - unit / origUnit) * 100) : 0;
                return (
                  <tr key={i} className="border-b border-sand/60">
                    <td className={`${td} text-muted`}>{i + 1}</td>
                    <td className={`${td} text-ink`}>{it.product?.name}{it.variant?.color ? ` – ${it.variant.color}` : ""} <span className="font-mono font-semibold text-ink bg-cream border border-sand rounded px-1.5 py-0.5 text-[11px] whitespace-nowrap">{it.variant?.sku ?? it.product?.sku}</span></td>
                    {!isCash && <td className={`${td} text-center text-muted`}>{HSN_JEWELLERY}</td>}
                    <td className={`${td} text-right`}>{it.qty}</td>
                    <td className={`${td} text-right ${discPct > 0 ? "text-muted line-through" : ""}`}>{formatPaise(origUnit)}</td>
                    <td className={`${td} text-right ${discPct > 0 ? "text-emerald-dark" : "text-muted"}`}>{discPct > 0 ? `${discPct}%` : "—"}</td>
                    <td className={`${td} text-right`}>{formatPaise(lineTaxable)}</td>
                  </tr>
                );
              })}
              <tr className="bg-cream/50 font-medium">
                <td className={td}></td><td className={`${td} text-ink`}>Total</td>{!isCash && <td className={td}></td>}
                <td className={`${td} text-right`}>{qtyTotal}</td><td className={td}></td><td className={td}></td>
                <td className={`${td} text-right`}>{formatPaise(itemsTaxable)}</td>
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
              <div className="flex justify-between text-muted"><span>{isCash ? "Sub-total" : "Taxable value (goods)"}</span><span>{formatPaise(itemsTaxable)}</span></div>
              {xPacking > 0 && <div className="flex justify-between text-muted"><span>Packing</span><span>{formatPaise(xPacking)}</span></div>}
              {xCourier > 0 && <div className="flex justify-between text-muted"><span>Courier</span><span>{formatPaise(xCourier)}</span></div>}
              {xAdjust !== 0 && <div className="flex justify-between text-muted"><span>Adjustment</span><span>{formatPaise(xAdjust)}</span></div>}
              {!isCash && xCharges !== 0 && <div className="flex justify-between text-muted font-medium border-t border-sand/40 pt-1"><span>Taxable value</span><span>{formatPaise(g.taxable)}</span></div>}
              {!isCash && !g.interState && <>
                <div className="flex justify-between text-muted"><span>CGST @{GST_RATE / 2}%</span><span>{formatPaise(g.cgst)}</span></div>
                <div className="flex justify-between text-muted"><span>SGST @{GST_RATE / 2}%</span><span>{formatPaise(g.sgst)}</span></div>
              </>}
              {!isCash && g.interState && <div className="flex justify-between text-muted"><span>IGST @{GST_RATE}%</span><span>{formatPaise(g.igst)}</span></div>}
              {roundOff !== 0 && <div className="flex justify-between text-muted"><span>Round off</span><span>{formatPaise(roundOff)}</span></div>}
              <div className="flex justify-between font-semibold text-ink border-t border-sand pt-2 text-base"><span>Grand Total</span><span>{formatPaise(roundedTotal)}</span></div>
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
            {can(session, "billing.sell") && balanceDue > 0 && (
              <div className="bg-white rounded-2xl p-5 shadow-card">
                <h2 className="font-medium text-ink mb-1">Record a payment</h2>
                <p className="text-xs text-muted mb-3">Balance due {formatPaise(balanceDue)}. Log an advance or part-payment.</p>
                <form action={recordPaymentAction} className="flex items-center gap-2 flex-wrap">
                  <input type="hidden" name="order_id" value={order.id} />
                  <span className="text-muted">₹</span>
                  <input name="amount" type="number" min={1} placeholder={String(Math.round(balanceDue / 100))} className="rounded-xl border border-sand px-3 py-2 text-sm w-28 outline-none focus:border-emerald" />
                  <select name="mode" className="rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald" title="How was it paid?">
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="upi">UPI</option>
                  </select>
                  <button className="btn-primary px-4 py-2 text-sm font-medium">Record</button>
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
                  {gstMode ? " · pinned" : " · auto by channel"}. A tax invoice is usually GST-exclusive — the rate is pre-tax and CGST/SGST is added on top.
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
