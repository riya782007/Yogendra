export const dynamic = "force-dynamic";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrder } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { OrderTimeline } from "@/components/site/OrderTimeline";

export const metadata = { title: "Order confirmed" };

export default async function OrderConfirm({ params }: { params: { id: string } }) {
  const data = await getOrder(params.id);
  if (!data) notFound();
  const { order, items } = data;
  return (
    <div className="max-w-2xl mx-auto px-5 py-14">
      <div className="text-center">
        <div className="mx-auto h-16 w-16 rounded-full bg-emerald-mist grid place-items-center text-emerald text-3xl animate-pop">✓</div>
        <h1 className="font-display text-4xl text-ink mt-4">Thank you!</h1>
        <p className="text-muted mt-2">Your order is confirmed. We&apos;ll WhatsApp you the tracking shortly.</p>
        <p className="text-xs text-muted mt-1">Order ID: {String(order.id).slice(0, 8).toUpperCase()}</p>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-card mt-8">
        <div className="space-y-3">
          {items.map((it: any, idx: number) => (
            <div key={idx} className="flex justify-between text-sm">
              <span className="text-ink/80">{it.product?.name} <span className="text-muted">× {it.qty}</span></span>
              <span className="text-ink">{formatPaise(it.line_total)}</span>
            </div>
          ))}
        </div>
        <div className="border-t border-sand mt-4 pt-3 flex justify-between font-semibold text-ink">
          <span>Total ({order.payment_mode?.toUpperCase()})</span><span>{formatPaise(order.total)}</span>
        </div>
      </div>
      <div className="bg-white rounded-2xl p-6 shadow-card mt-6" data-x="order-timeline">
        <h2 className="font-medium text-ink mb-4">Order status</h2>
        <OrderTimeline order={order} />
      </div>
      <div className="text-center mt-8">
        <Link href={`/account?order=${order.id}`} className="btn-primary inline-block px-7 py-3 text-sm font-medium">Track this order</Link>
        <Link href="/shop" className="inline-block ml-2 px-7 py-3 text-sm font-medium rounded-full border border-ink/15 text-ink hover:border-emerald hover:text-emerald transition-colors">Continue shopping</Link>
      </div>
    </div>
  );
}
