export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getEstimate } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { EstimatePrint } from "@/components/admin/EstimatePrint";
import { UpiAmountQr } from "@/components/admin/UpiAmountQr";
import { BUSINESS, HSN_JEWELLERY, GST_RATE, gstSplit, gstSplitExclusive, stateCodeFromGstin, bankHasDetails, amountInWords } from "@/lib/business";
import { requirePerm } from "@/lib/auth";
import { EstimateEditor } from "@/components/admin/EstimateEditor";

export const metadata = { title: "Estimate / Quotation" };

export default async function EstimateDetailPage({ params, searchParams }: { params: { id: string }; searchParams?: { billerror?: string } }) {
  // When "Bill · GST/Cash" fails (e.g. a line is out of stock) billEstimateAction redirects back
  // here with ?billerror=… — surface it loudly instead of silently returning to the estimate, which
  // made a stock-blocked bill look like "nothing happened / it won't convert".
  const billError = (searchParams?.billerror ?? "").trim();
  const data = await getEstimate(params.id);
  if (!data) notFound();
  const { estimate, items } = data;
  const isOpen = estimate.status === "open";
  const canEdit = isOpen && (await requirePerm("estimates.create"));
  const total = estimate.total as number;

  // --- Tax treatment (mirrors the invoice exactly, so a quote and the bill it becomes agree) ---
  // gst=false → plain estimate, no tax shown. Otherwise EXCLUSIVE by default: the quoted rate is
  // pre-tax and GST is added on top; INCLUSIVE means GST is already inside the quoted rate.
  // GST is OPTIONAL and OFF by default — show tax ONLY when it was explicitly turned on (gst === true).
  // Previously `gst !== false` treated a null/unset estimate as taxed, so estimates made WITHOUT
  // choosing GST still showed 3% GST. Now no tax appears unless the owner deliberately turned it on.
  const gstOn = (estimate as any).gst === true;
  const gstMode = (((estimate as any).gst_mode as string) ?? "exclusive") === "inclusive" ? "inclusive" : "exclusive";
  const gstExclusive = gstOn && gstMode === "exclusive";
  const buyerStateCode = (estimate as any).buyer_state || stateCodeFromGstin((estimate as any).buyer_gstin);
  const g = gstOn ? (gstExclusive ? gstSplitExclusive(total, buyerStateCode) : gstSplit(total, buyerStateCode)) : null;
  // Extra charges are folded into the total so GST applies to them; split them back out to itemise.
  const xPacking = ((estimate as any).extra_packing as number) || 0;
  const xCourier = ((estimate as any).extra_courier as number) || 0;
  const xAdjust = ((estimate as any).extra_adjustment as number) || 0;
  const xDiscount = ((estimate as any).extra_discount as number) || 0;
  const xTcs = ((estimate as any).extra_tcs as number) || 0;
  const xCharges = xPacking + xCourier + xAdjust + xTcs - xDiscount;
  const itemsTotal = total - xCharges;
  const itemsTaxable = (!gstOn || gstExclusive) ? itemsTotal : Math.round(itemsTotal / (1 + GST_RATE / 100));
  const payable = !gstOn ? total : gstExclusive ? total + (g?.tax ?? 0) : total;
  const roundedTotal = Math.round(payable / 100) * 100;
  const roundOff = roundedTotal - payable;

  const ref = "EST-" + String(estimate.id).slice(0, 8).toUpperCase();
  const date = new Date(estimate.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  // Quotes are valid 7 days — printing the actual date avoids "valid for 7 days from when?" disputes.
  const validTill = new Date(new Date(estimate.created_at).getTime() + 7 * 86400000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const qtyTotal = items.reduce((s: number, it: any) => s + it.qty, 0);
  const { data: pmRows } = await supabaseServer().from("payment_methods").select("upi_id,name,is_default").eq("active", true);
  const defUpi = ((pmRows as any[]) ?? []).filter((m) => m.upi_id).sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0))[0] ?? null;
  const th = "py-2 px-2 text-xs font-semibold text-ink/70";
  const td = "py-2 px-2 align-top";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Link href="/admin/estimates" className="text-sm text-emerald nav-link">← Estimates</Link>
          <div className="flex items-center gap-2">
            {canEdit && <a href="#edit-estimate" className="px-4 py-2 rounded-full bg-emerald-mist text-emerald-dark text-sm font-medium hover:bg-emerald/20">✏️ Edit items &amp; prices</a>}
            <EstimatePrint />
          </div>
        </div>
        {billError && (
          <div className="no-print mb-4 rounded-2xl border border-rose/50 bg-rose/10 p-4 text-sm text-rose">
            <b>Couldn’t bill this estimate:</b> {billError}
            <div className="mt-1 text-rose/80">Fix the flagged item (add stock, reduce its quantity, or remove the line), then try “Bill” again. To bill anyway as a backorder, use the “Bill” option with backorder enabled.</div>
          </div>
        )}
        {!isOpen && (
          <div className="no-print mb-4 rounded-2xl border border-gold/40 bg-gold/5 p-3 text-sm text-gold-dark">
            This estimate is <b className="capitalize">{String(estimate.status).replace("_", " ")}</b>, so its items and prices are locked.
            {estimate.order_id && <> View the <Link href={`/admin/invoice/${estimate.order_id}`} className="text-emerald nav-link">billed invoice →</Link></>}
            {(estimate.status === "denied" || estimate.status === "expired") && <> Re-open it from the <Link href="/admin/estimates" className="text-emerald nav-link">Estimates list</Link> to edit again.</>}
          </div>
        )}

        <div className="print-area bg-white rounded-2xl shadow-card p-5 sm:p-8 text-[13px]" id="estimate">
          <div className="text-center pb-3 mb-3 border-b-2 border-ink/80">
            <p className="text-[15px] font-bold tracking-wide text-ink">ESTIMATE / QUOTATION</p>
            <p className="text-[10px] text-muted">
              This is not a tax invoice. Prices valid for 7 days.
              {gstOn ? ` GST @${GST_RATE}% ${gstExclusive ? "extra as shown below" : "included in the rates shown"}.` : " Quoted without GST."}
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 border border-sand rounded-lg overflow-hidden">
            <div className="p-4 border-b sm:border-b-0 sm:border-r border-sand">
              <p className="font-display text-2xl text-ink leading-none">{BUSINESS.brand}</p>
              <p className="text-xs text-muted mt-0.5">{BUSINESS.legalName}</p>
              <p className="text-xs text-muted mt-1">{BUSINESS.address}</p>
              {gstOn && <p className="text-xs text-ink mt-1"><b>GSTIN:</b> {BUSINESS.gstin}</p>}
              {gstOn && <p className="text-xs text-muted"><b>PAN:</b> {BUSINESS.pan} · State: {BUSINESS.stateName} ({BUSINESS.stateCode})</p>}
              <p className="text-xs text-muted">{BUSINESS.phone} · {BUSINESS.email}</p>
            </div>
            <div className="p-4 text-xs space-y-1">
              <div className="flex justify-between"><span className="text-muted">Estimate No.</span><span className="font-medium text-ink">{ref}</span></div>
              <div className="flex justify-between"><span className="text-muted">Date</span><span className="text-ink">{date}</span></div>
              <div className="flex justify-between"><span className="text-muted">Valid till</span><span className="text-ink">{validTill}</span></div>
              <div className="flex justify-between"><span className="text-muted">Status</span><span className="text-ink capitalize">{String(estimate.status).replace("_", " ")}</span></div>
              <div className="flex justify-between"><span className="text-muted">Tax</span><span className="text-ink">{gstOn ? `GST ${gstExclusive ? "extra" : "inclusive"}` : "Without GST"}</span></div>
            </div>
          </div>

          {/* Billing & shipping parties side by side — dealers ship to a different address often enough
              that a quote without it gets queried. Shipping falls back to billing when not set. */}
          <div className="grid sm:grid-cols-2 gap-0 border border-t-0 border-sand rounded-b-lg -mt-px">
            <div className="p-4 border-b sm:border-b-0 sm:border-r border-sand">
              <p className="text-[10px] uppercase tracking-wide text-gold-dark font-semibold mb-1">Billing Address</p>
              <p className="text-ink font-medium">{estimate.customer_name || "—"}</p>
              {(estimate as any).buyer_address && <p className="text-muted text-xs whitespace-pre-line">{(estimate as any).buyer_address}</p>}
              {estimate.customer_phone && <p className="text-muted text-xs">Ph: {estimate.customer_phone}</p>}
              {(estimate as any).buyer_email && <p className="text-muted text-xs">{(estimate as any).buyer_email}</p>}
              {gstOn && (estimate as any).buyer_gstin && <p className="text-xs text-ink mt-0.5"><b>GSTIN:</b> {(estimate as any).buyer_gstin}</p>}
            </div>
            <div className="p-4">
              <p className="text-[10px] uppercase tracking-wide text-gold-dark font-semibold mb-1">Shipping Address</p>
              <p className="text-ink font-medium">{(estimate as any).ship_to_name || estimate.customer_name || "—"}</p>
              <p className="text-muted text-xs whitespace-pre-line">{(estimate as any).ship_to_address || (estimate as any).buyer_address || "Same as billing address"}</p>
              {estimate.customer_phone && <p className="text-muted text-xs">Ph: {estimate.customer_phone}</p>}
            </div>
          </div>

          <table className="w-full mt-4 border border-sand">
            <thead className="bg-cream border-b border-sand">
              <tr className="text-left">
                <th className={th}>#</th><th className={th}>Item</th><th className={th}>SKU</th>
                {gstOn && <th className={`${th} text-center`}>HSN</th>}
                <th className={`${th} text-right`}>Qty</th><th className={`${th} text-right`}>Price</th>
                <th className={`${th} text-right`}>{gstOn ? "Taxable Value" : "Total Amount"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => {
                // When rates are quoted GST-inclusive, strip the tax back out so the taxable column is honest.
                const unit = (!gstOn || gstExclusive) ? it.unit_price : Math.round(it.unit_price / (1 + GST_RATE / 100));
                const lineTaxable = (!gstOn || gstExclusive) ? it.line_total : Math.round(it.line_total / (1 + GST_RATE / 100));
                return (
                  <tr key={i} className="border-b border-sand/60">
                    <td className={`${td} text-muted`}>{i + 1}</td>
                    <td className={`${td} text-ink`}>{it.product?.name}{it.variant?.color ? <span className="text-ink"> · {it.variant.color}</span> : ""}</td>
                    <td className={`${td} font-mono text-sm font-bold text-ink`}>{it.variant?.sku ?? it.product?.sku}</td>
                    {gstOn && <td className={`${td} text-center text-muted`}>{HSN_JEWELLERY}</td>}
                    <td className={`${td} text-right`}>{it.qty}</td>
                    <td className={`${td} text-right`}>{formatPaise(unit)}</td>
                    <td className={`${td} text-right`}>{formatPaise(lineTaxable)}</td>
                  </tr>
                );
              })}
              <tr className="bg-cream/50 font-medium">
                <td className={td}></td><td className={`${td} text-ink`}>Total</td><td className={td}></td>{gstOn && <td className={td}></td>}
                <td className={`${td} text-right`}>{qtyTotal}</td><td className={td}></td>
                <td className={`${td} text-right`}>{formatPaise(itemsTaxable)}</td>
              </tr>
            </tbody>
          </table>

          {/* Totals — the full breakdown a dealer needs to compare this quote against a real bill. */}
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <div className="text-xs">
              <p className="text-muted mb-1">Amount in words</p>
              <p className="text-ink font-medium">{amountInWords(roundedTotal)}</p>
              {gstOn && bankHasDetails() && (
                <div className="mt-4">
                  <p className="text-muted mb-1">Bank details</p>
                  <p className="text-ink">{BUSINESS.bank.name} · A/C {BUSINESS.bank.account}</p>
                  <p className="text-ink">{[BUSINESS.bank.ifsc && `IFSC ${BUSINESS.bank.ifsc}`, BUSINESS.bank.branch].filter(Boolean).join(" · ")}</p>
                </div>
              )}
              {defUpi?.upi_id && (
                <div className="mt-4">
                  <UpiAmountQr upiId={defUpi.upi_id} payeeName={defUpi.name} amountPaise={roundedTotal} note={`Estimate ${String(estimate.id).slice(0, 8).toUpperCase()}`} />
                </div>
              )}
            </div>
            <div className="text-sm space-y-1">
              <div className="flex justify-between text-muted"><span>Total Quantity</span><span>{qtyTotal}</span></div>
              {gstOn && g && <div className="flex justify-between text-muted"><span>Total Tax ({gstExclusive ? "EXCL" : "INCL"})</span><span>{formatPaise(g.tax)}</span></div>}
              <div className="flex justify-between text-muted border-t border-sand/40 pt-1"><span>{gstOn ? "Taxable value (goods)" : "Subtotal"}</span><span>{formatPaise(itemsTaxable)}</span></div>
              {xDiscount > 0 && <div className="flex justify-between text-emerald-dark"><span>Discount</span><span>− {formatPaise(xDiscount)}</span></div>}
              {xPacking > 0 && <div className="flex justify-between text-muted"><span>Packing</span><span>{formatPaise(xPacking)}</span></div>}
              {xCourier > 0 && <div className="flex justify-between text-muted"><span>Shipping / Courier</span><span>{formatPaise(xCourier)}</span></div>}
              {xTcs > 0 && <div className="flex justify-between text-muted"><span>TCS</span><span>{formatPaise(xTcs)}</span></div>}
              {xAdjust !== 0 && <div className="flex justify-between text-muted"><span>Adjustment</span><span>{formatPaise(xAdjust)}</span></div>}
              {gstOn && g && xCharges !== 0 && <div className="flex justify-between text-muted font-medium border-t border-sand/40 pt-1"><span>Taxable value</span><span>{formatPaise(g.taxable)}</span></div>}
              {gstOn && g && !g.interState && <>
                <div className="flex justify-between text-muted"><span>CGST @{GST_RATE / 2}%</span><span>{formatPaise(g.cgst)}</span></div>
                <div className="flex justify-between text-muted"><span>SGST @{GST_RATE / 2}%</span><span>{formatPaise(g.sgst)}</span></div>
              </>}
              {gstOn && g && g.interState && <div className="flex justify-between text-muted"><span>IGST @{GST_RATE}%</span><span>{formatPaise(g.igst)}</span></div>}
              {roundOff !== 0 && <div className="flex justify-between text-muted"><span>Round off</span><span>{formatPaise(roundOff)}</span></div>}
              <div className="flex justify-between font-semibold text-ink border-t border-sand pt-2 text-base"><span>Estimated Total</span><span>{formatPaise(roundedTotal)}</span></div>
              {gstOn && <p className="text-[10px] text-muted pt-1">{gstExclusive ? `Rates quoted are pre-tax; GST @${GST_RATE}% added above.` : `Rates quoted include GST @${GST_RATE}%.`}</p>}
            </div>
          </div>

          {/* HSN-wise tax summary — same shape as the invoice, so the two documents reconcile. */}
          {gstOn && g && (
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
                    <td className="p-2 text-right font-medium">{formatPaise(g.tax)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 border-t border-sand pt-3 text-[10px] text-muted">
            <p className="font-medium text-ink mb-1">Terms</p>
            <p>1. This is an estimate/quotation, not a tax invoice — no tax is payable against this document.</p>
            <p>2. Valid till {validTill}. Prices and availability may change after this date.</p>
            <p>3. Stock is reserved only on confirmation; goods remain subject to availability until then.</p>
            {gstOn && <p>4. {gstExclusive ? `GST @${GST_RATE}% is charged extra as shown.` : `Rates shown are inclusive of GST @${GST_RATE}%.`} A tax invoice will be issued on billing.</p>}
            <p>5. Please read the return policy for clarification on the return process.</p>
            <p className="mt-2">Thanks for doing business with us. We hope to grow the relationship furthermore.</p>
            <p>We declare that this document shows the actual price of the goods described and that all particulars are true and correct.</p>
            <div className="flex justify-between items-end mt-6">
              <span>&nbsp;</span>
              <div className="text-center">
                <div className="h-10" />
                <p className="border-t border-ink/40 pt-1 px-6">Authorised Signatory</p>
                <p className="text-ink">for {BUSINESS.legalName}</p>
              </div>
            </div>
            <p className="text-center mt-3">{BUSINESS.brand} · {BUSINESS.phone}</p>
          </div>
        </div>

        {/* Edit panel — one editable screen for the whole estimate (open estimates only; locks once billed). */}
        {canEdit && (
          <EstimateEditor
            estimateId={estimate.id}
            initialLines={items.map((it: any) => ({
              id: it.id,
              name: `${it.product?.name ?? ""}${it.variant?.color ? ` · ${it.variant.color}` : ""}`.trim(),
              sku: it.variant?.sku ?? it.product?.sku ?? "",
              qty: it.qty,
              priceRupees: (it.unit_price ?? 0) / 100,
            }))}
            initialCharges={{ discount: xDiscount / 100, packing: xPacking / 100, courier: xCourier / 100, tcs: xTcs / 100, adjustment: xAdjust / 100 }}
            initialTax={!gstOn ? "none" : gstMode}
            initialCustomer={{
              name: estimate.customer_name ?? "", phone: estimate.customer_phone ?? "",
              gstin: (estimate as any).buyer_gstin ?? "", address: (estimate as any).buyer_address ?? "",
              email: (estimate as any).buyer_email ?? "", shipName: (estimate as any).ship_to_name ?? "", shipAddr: (estimate as any).ship_to_address ?? "",
            }}
          />
        )}
      </div>
    </main>
  );
}
