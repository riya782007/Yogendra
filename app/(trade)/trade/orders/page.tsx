export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getWholesaleOrderHistory } from "@/lib/supabase/queries";
import { getWholesaleSession } from "@/lib/wholesale";
import { formatPaise } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Trade Orders",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TradeOrders() {
  const session = await getWholesaleSession();
  if (!session) redirect("/trade");
  const history = await getWholesaleOrderHistory(session.id, session.phone).catch(() => []);

  return (
    <div className="max-w-4xl mx-auto px-5 py-8">
      <h1 className="font-display text-4xl text-ink mb-1">Your Orders</h1>
      <p className="text-sm text-muted mb-6">Every bill on your account — trade-portal orders and counter purchases — {history.length || "0"} in all. <Link href="/trade" className="text-emerald nav-link">Place a new order →</Link></p>

      {history.length === 0 ? (
        <p className="text-sm text-muted bg-white rounded-2xl border border-sand p-8 text-center">No past orders yet — place your first from the dashboard.</p>
      ) : (
        <div className="space-y-4">
          {history.map((h) => (
            <div key={h.id} className="bg-white rounded-2xl border border-sand p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-ink">{h.invoice_no ? `Invoice ${h.invoice_no}` : `Order ${h.id.slice(0, 8)}`}</p>
                  <p className="text-xs text-muted">{new Date(h.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-ink">{formatPaise(h.total)}</p>
                  {String(h.status).toLowerCase() === "cancelled"
                    ? <p className="text-[11px] text-rose">Cancelled</p>
                    : h.total - h.amountPaid > 0
                      ? <p className="text-[11px] text-gold-dark">Due {formatPaise(h.total - h.amountPaid)}</p>
                      : <p className="text-[11px] text-emerald-dark">Paid</p>}
                </div>
              </div>
              <ul className="mt-3 text-sm text-ink/75 space-y-0.5">
                {h.items.map((it, i) => (
                  <li key={i} className="flex justify-between"><span>{it.name} <span className="font-mono text-muted">({it.sku})</span></span><span className="text-muted">× {it.qty}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
