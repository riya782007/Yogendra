"use client";
import { useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/pricing";

type O = { id: string; total: number; customer_name: string | null; created_at: string; bill_type?: string; payment_mode?: string };

export function ExpandableReport({
  title, channelKey, revenue, count, orders, from, to, accent,
}: {
  title: string; channelKey: string; revenue: number; count: number; orders: O[];
  from?: string; to?: string; accent?: string;
}) {
  const [open, setOpen] = useState(false);
  const deep = `/admin/sales?channel=${channelKey}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;

  return (
    <div className="bg-white rounded-2xl shadow-card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-5 hover:bg-cream/30 transition-colors">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
            <p className={`text-2xl font-semibold mt-1 ${accent ?? "text-ink"}`}>{formatPaise(revenue)}</p>
            <p className="text-xs text-muted mt-0.5">{count} order{count === 1 ? "" : "s"}</p>
          </div>
          <span className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-sand px-5 py-4">
          {orders.length === 0 ? (
            <p className="text-sm text-muted">No orders in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted text-left"><tr><th className="py-1.5">Order</th><th className="py-1.5">Date</th><th className="py-1.5">Customer</th><th className="py-1.5 text-right">Amount</th></tr></thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-t border-sand/50">
                      <td className="py-1.5"><Link href={`/admin/invoice/${o.id}`} className="text-emerald nav-link">{String(o.id).slice(0, 8).toUpperCase()} ↗</Link></td>
                      <td className="py-1.5 text-muted">{new Date(o.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
                      <td className="py-1.5 text-ink">{o.customer_name || "Walk-in"}</td>
                      <td className="py-1.5 text-right font-medium">{formatPaise(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link href={deep} className="inline-block mt-3 text-sm text-emerald nav-link">Open full {title} report →</Link>
        </div>
      )}
    </div>
  );
}
