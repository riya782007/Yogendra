export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { PrintButton } from "@/components/admin/PrintButton";

export const metadata = { title: "Invoice" };

export default async function Invoice({ params }: { params: { id: string } }) {
  const data = await getOrder(params.id);
  if (!data) notFound();
  const { order, items } = data;
  const total = order.total as number;
  const taxable = Math.round(total / 1.03);
  const gst = total - taxable;
  const cgst = Math.round(gst / 2);
  const sgst = gst - cgst;
  const invNo = "BD-" + String(order.id).slice(0, 8).toUpperCase();
  const date = new Date(order.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4 no-print">
          <Link href="/admin/billing" className="text-sm text-emerald nav-link">← New sale</Link>
          <PrintButton />
        </div>

        <div className="print-area bg-white rounded-2xl shadow-card p-8" id="invoice">
          <div className="flex justify-between items-start border-b border-sand pb-5">
            <div>
              <p className="font-display text-3xl text-ink">Blythe Diva</p>
              <p className="text-xs text-muted">Yogendra Industries</p>
              <p className="text-xs text-muted mt-1">Sadar Bazar, Rui Mandi, Delhi 110006</p>
              <p className="text-xs text-muted">GSTIN: 07ABCDE1234F1Z5 · +91 98731 51767</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold text-ink">TAX INVOICE</p>
              <p className="text-xs text-muted mt-1">No: {invNo}</p>
              <p className="text-xs text-muted">Date: {date}</p>
              <p className="text-xs text-muted">Payment: {String(order.payment_mode).toUpperCase()}</p>
            </div>
          </div>

          <div className="py-4 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">Bill to</p>
            <p className="text-ink font-medium">{order.customer_name || "Walk-in customer"}</p>
            {order.customer_phone && <p className="text-muted text-xs">{order.customer_phone}</p>}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-sand text-muted text-left">
                <th className="py-2">#</th><th className="py-2">Item</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Rate</th><th className="py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it: any, i: number) => (
                <tr key={i} className="border-b border-sand/50">
                  <td className="py-2 text-muted">{i + 1}</td>
                  <td className="py-2 text-ink">{it.product?.name} <span className="text-muted text-xs">({it.product?.sku})</span></td>
                  <td className="py-2 text-right">{it.qty}</td>
                  <td className="py-2 text-right">{formatPaise(it.unit_price)}</td>
                  <td className="py-2 text-right">{formatPaise(it.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex justify-end mt-4">
            <div className="w-64 text-sm space-y-1">
              <div className="flex justify-between text-muted"><span>Taxable value</span><span>{formatPaise(taxable)}</span></div>
              <div className="flex justify-between text-muted"><span>CGST @1.5%</span><span>{formatPaise(cgst)}</span></div>
              <div className="flex justify-between text-muted"><span>SGST @1.5%</span><span>{formatPaise(sgst)}</span></div>
              <div className="flex justify-between font-semibold text-ink border-t border-sand pt-2 text-base"><span>Total</span><span>{formatPaise(total)}</span></div>
            </div>
          </div>

          <p className="text-center text-xs text-muted mt-8 border-t border-sand pt-4">Thank you for shopping with Blythe Diva ✦ Goods once sold are subject to our return policy. This is a computer-generated invoice.</p>
        </div>
      </div>
    </main>
  );
}
