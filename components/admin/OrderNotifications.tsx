"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { formatPaise } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";

type O = {
  id: string;
  invoice_no: string | null;
  channel: string | null;
  status: string | null;
  total: number;
  amount_paid: number;
  payment_mode?: string | null;
  customer_name: string | null;
  created_at: string;
};
const CH: Record<string, string> = { retail: "Online", wholesale: "Wholesale", pos: "Counter" };
const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Live "New Orders" panel — SSR-seeded, then polls every 30s and toasts when a new order arrives. */
export function OrderNotifications({ initial }: { initial: { orders: O[]; last24h: number } }) {
  const { toast } = useToast();
  const [orders, setOrders] = useState<O[]>(initial.orders);
  const [last24h, setLast24h] = useState(initial.last24h);
  const seen = useRef<Set<string>>(new Set(initial.orders.map((o) => o.id)));
  const [, force] = useState(0);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/admin/recent-orders", { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d = await r.json();
        const list: O[] = d.orders ?? [];
        const fresh = list.filter((o) => !seen.current.has(o.id));
        if (fresh.length) {
          fresh.forEach((o) => seen.current.add(o.id));
          const store = fresh.filter((o) => String(o.channel || "").toLowerCase() !== "pos");
          if (store.length) {
            const cods = store.filter((o) => isCodOrder(o));
            const prepaids = store.filter((o) => !isCodOrder(o));
            if (cods.length) {
              toast(
                `💵 ${cods.length} new COD order${cods.length > 1 ? "s" : ""} — ${cods[0].customer_name || "Customer"} · ${formatPaise(cods[0].total)} (collect on delivery)`,
                "success"
              );
            }
            if (prepaids.length) {
              toast(
                `🛍️ ${prepaids.length} new prepaid order${prepaids.length > 1 ? "s" : ""} — ${prepaids[0].customer_name || "Customer"} · ${formatPaise(prepaids[0].total)}`,
                "success"
              );
            }
          }
        }
        setOrders(list);
        setLast24h(d.last24h ?? 0);
      } catch {
        /* ignore transient poll errors */
      }
    };
    const id = setInterval(tick, 30000);
    const rel = setInterval(() => force((n) => n + 1), 60000);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(rel);
    };
  }, [toast]);

  return (
    <div className="bg-white rounded-2xl shadow-card p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔔</span>
          <h3 className="font-display text-xl text-ink">New Orders</h3>
          {last24h > 0 && (
            <span className="text-[11px] font-semibold rounded-full bg-rose text-white px-2 py-0.5">
              {last24h} in 24h
            </span>
          )}
          <span className="ml-1 flex items-center gap-1 text-[10px] text-emerald-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-light animate-pulse" />
            live
          </span>
        </div>
        <Link href="/admin/orders" className="text-sm text-emerald nav-link">
          View all →
        </Link>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">
          No orders yet — they will appear here the moment one comes in.
        </p>
      ) : (
        <ul className="divide-y divide-sand/70">
          {orders.map((o) => {
            const isNew = Date.now() - new Date(o.created_at).getTime() < 6 * 3600 * 1000;
            const cod = isCodOrder(o);
            return (
              <li key={o.id} className="py-2.5 flex items-center gap-3">
                <span
                  className={`h-2 w-2 rounded-full shrink-0 ${isNew ? "bg-rose animate-pulse" : "bg-sand"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">
                    {o.customer_name || "Guest"}{" "}
                    <span className="text-muted">· {CH[o.channel || ""] || o.channel || "—"}</span>
                  </p>
                  <p className="text-[11px] text-muted">
                    {o.invoice_no ? `#${o.invoice_no} · ` : ""}
                    {timeAgo(o.created_at)}
                    {o.status ? ` · ${o.status}` : ""}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-ink">{formatPaise(o.total)}</p>
                  <div className="flex items-center justify-end gap-1 mt-0.5">
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                        cod ? "bg-gold-dark text-white" : "bg-emerald text-white"
                      }`}
                    >
                      {cod ? "COD" : "PREPAID"}
                    </span>
                    {isNew && <span className="text-[10px] font-semibold text-rose">NEW</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
