export const dynamic = "force-dynamic";
/**
 * PACKING SLIP — a clean, large-print pick list the owner downloads (browser Print → Save as PDF) and
 * hands to staff to get an order ready for delivery. Big photos, colour, SKU and qty per line with a
 * tick box to check off as they pack; the customer + delivery address at the top. NO prices — this is
 * a warehouse document, not a bill. Readable at arm's length (owner: "staff ko saaf dikhna chahiye").
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { BUSINESS } from "@/lib/business";
import { PrintButton } from "@/components/admin/PrintButton";

export const metadata = { title: "Packing Slip" };

export default async function PackingSlip({ params }: { params: { id: string } }) {
  const sb = supabaseServer();
  const { data: order } = await sb.from("orders")
    .select("id,invoice_no,channel,customer_name,customer_phone,buyer_address,payment_mode,amount_paid,total,courier_name,tracking_no,created_at, order_items(qty, product:products(id,name,sku,thumbnail_path), variant:variants(id,product_id,sku,color,image_paths))")
    .eq("id", params.id).maybeSingle();
  if (!order) notFound();
  const o = order as any;
  const items = (o.order_items as any[]) ?? [];

  // A photo for EVERY line. Product photos live on the VARIANT (image_paths) and on the product's
  // thumbnail_path — the old code only checked the (unused, empty) product_images table + the variant,
  // so any colour/line without its OWN photo printed blank. Resolve: the line's own colour photo →
  // the product's thumbnail → ANY sibling colour's photo of the same product.
  const httpFirst = (arr?: any[]): string | undefined => (Array.isArray(arr) ? arr.find((u: any) => typeof u === "string" && u.startsWith("http")) : undefined);
  const isHttp = (s: any): s is string => typeof s === "string" && s.startsWith("http");
  const productIds = Array.from(new Set(items.map((it: any) => it.product?.id).filter(Boolean)));
  const siblingByProduct = new Map<string, string>();
  if (productIds.length) {
    const { data: sib } = await sb.from("variants").select("product_id,image_paths").in("product_id", productIds as string[]);
    for (const v of ((sib as any[]) ?? [])) {
      const img = httpFirst(v.image_paths as any[]);
      if (img && !siblingByProduct.has(v.product_id)) siblingByProduct.set(v.product_id, img);
    }
  }
  const imgFor = (it: any): string | undefined =>
    httpFirst(it.variant?.image_paths)
    ?? (isHttp(it.product?.thumbnail_path) ? it.product.thumbnail_path : undefined)
    ?? (it.product?.id ? siblingByProduct.get(it.product.id) : undefined);

  const ref = o.invoice_no || String(o.id).slice(0, 8).toUpperCase();
  const totalPcs = items.reduce((s: number, it: any) => s + (it.qty ?? 0), 0);
  const date = new Date(o.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const prepaid = (o.amount_paid ?? 0) >= (o.total ?? 0) && (o.total ?? 0) > 0;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <style dangerouslySetInnerHTML={{ __html: `@media print{
        @page{size:A4;margin:12mm}
        .print-area{font-size:14px !important;line-height:1.5 !important;padding:0 !important;box-shadow:none !important;border-radius:0 !important}
        .print-area .slip-title{font-size:1.9rem !important}
        .print-area table{font-size:14px !important}
        .print-area table td,.print-area table th{padding-top:9px !important;padding-bottom:9px !important}
        .print-area [class*="text-[11px]"]{font-size:12.5px !important}
        .print-area [class*="text-xs"]{font-size:13px !important}
        .print-area tr{page-break-inside:avoid}
        .print-area thead{display:table-header-group}
      }` }} />
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Link href="/admin/orders" className="text-sm text-emerald nav-link">← Orders</Link>
          <PrintButton />
        </div>

        <div className="print-area bg-white rounded-2xl shadow-card p-6 sm:p-8" id="packslip">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-ink/80 pb-3 mb-4">
            <div>
              <p className="slip-title font-bold text-2xl text-ink leading-none">PACKING SLIP</p>
              <p className="text-xs text-muted mt-1">For dispatch — not a bill</p>
            </div>
            <div className="text-right">
              <p className="font-display text-xl text-ink leading-none">{BUSINESS.brand}</p>
              <p className="text-xs text-muted mt-1">Order <b className="text-ink">{ref}</b></p>
              <p className="text-xs text-muted">{date}</p>
            </div>
          </div>

          {/* Ship to */}
          <div className="grid sm:grid-cols-2 gap-3 mb-5">
            <div className="rounded-lg border border-sand p-3">
              <p className="text-[11px] uppercase tracking-wide text-muted mb-1">Deliver to</p>
              <p className="text-ink font-semibold text-base">{o.customer_name || "Customer"}</p>
              {o.customer_phone && <p className="text-sm text-ink">📞 {o.customer_phone}</p>}
              {o.buyer_address && <p className="text-sm text-ink mt-1 whitespace-pre-line">📦 {o.buyer_address}</p>}
              {!o.buyer_address && <p className="text-xs text-gold-dark mt-1">No address on file — confirm before dispatch.</p>}
            </div>
            <div className="rounded-lg border border-sand p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted">Channel</span><span className="text-ink capitalize">{o.channel}</span></div>
              <div className="flex justify-between"><span className="text-muted">Payment</span><span className={prepaid ? "text-emerald-dark font-medium" : "text-gold-dark font-medium"}>{prepaid ? "PREPAID ✓" : o.payment_mode === "cod" ? "COD — collect on delivery" : "Unpaid — check before dispatch"}</span></div>
              <div className="flex justify-between border-t border-sand/60 mt-1 pt-1"><span className="text-muted">Total pieces</span><span className="text-ink font-bold text-lg">{totalPcs}</span></div>
              {o.courier_name && <div className="flex justify-between"><span className="text-muted">Courier</span><span className="text-ink">{o.courier_name}</span></div>}
              {o.tracking_no && <div className="flex justify-between"><span className="text-muted">AWB</span><span className="text-ink font-mono">{o.tracking_no}</span></div>}
            </div>
          </div>

          {/* Items — big list with photos + a tick box for staff to check off */}
          <table className="w-full border border-sand">
            <thead className="bg-cream border-b border-sand text-left">
              <tr>
                <th className="p-3 w-10 text-center">✓</th>
                <th className="p-3">Item</th>
                <th className="p-3">SKU</th>
                <th className="p-3 text-center w-16">Qty</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => {
                const img = imgFor(it);
                return (
                  <tr key={i} className="border-b border-sand/60 align-middle">
                    <td className="p-3 text-center"><span className="inline-block w-6 h-6 border-2 border-ink/50 rounded" /></td>
                    <td className="p-2">
                      <div className="flex items-center gap-3">
                        <div className="h-16 w-14 rounded-lg overflow-hidden bg-cream border border-sand shrink-0">
                          {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <span className="flex items-center justify-center h-full text-[10px] text-muted">—</span>}
                        </div>
                        <div className="min-w-0">
                          <p className="text-ink font-medium leading-tight">{it.product?.name ?? it.variant?.sku ?? "Item"}</p>
                          {it.variant?.color && <p className="text-sm text-emerald-dark">{it.variant.color}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="p-3 font-mono text-sm text-muted">{it.variant?.sku ?? it.product?.sku}</td>
                    <td className="p-3 text-center"><span className="text-xl font-bold text-ink">{it.qty}</span></td>
                  </tr>
                );
              })}
              <tr className="bg-cream/50 font-medium">
                <td className="p-3"></td><td className="p-3 text-ink">Total</td><td className="p-3"></td>
                <td className="p-3 text-center text-xl font-bold text-ink">{totalPcs}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-6 flex justify-between items-end text-sm">
            <div>
              <p className="text-muted">Packed by _____________________</p>
              <p className="text-muted mt-3">Checked by _____________________</p>
            </div>
            <p className="text-[11px] text-muted text-right">{BUSINESS.brand} · {BUSINESS.phone}<br />Tick each item as you pack it.</p>
          </div>
        </div>
      </div>
    </main>
  );
}
