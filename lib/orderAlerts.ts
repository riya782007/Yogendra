/** Server helpers for dashboard order alerts — COD vs prepaid labelling depends on payment_mode. */
import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { isCodOrder } from "@/lib/orderPayment";

export type OrderAlertRow = {
  id: string;
  invoice_no: string | null;
  channel: string | null;
  status: string | null;
  total: number;
  amount_paid: number;
  payment_mode: string | null;
  customer_name: string | null;
  created_at: string;
};

/** Latest orders + 24h count — powers live New Orders + toast. Includes payment_mode for COD/PREPAID badges. */
export async function getOrderAlertsWithPayment(limit = 8): Promise<{ orders: OrderAlertRow[]; last24h: number }> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [listRes, cntRes] = await Promise.all([
    sb
      .from("orders")
      .select("id,invoice_no,channel,status,total,amount_paid,payment_mode,customer_name,created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    sb.from("orders").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);
  return { orders: ((listRes.data as any[]) ?? []) as OrderAlertRow[], last24h: cntRes.count ?? 0 };
}

export type PendingCodOrderRow = {
  id: string;
  invoice_no: string | null;
  channel: string | null;
  status: string | null;
  total: number;
  amount_paid: number;
  payment_mode: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  created_at: string;
};

/** Held unpaid COD (payment_mode=cod && not fully paid) — dashboard panel + /admin/cod. */
export async function getPendingCodOrders(limit = 12): Promise<PendingCodOrderRow[]> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("orders")
    .select("id,invoice_no,channel,status,total,amount_paid,payment_mode,customer_name,customer_phone,created_at")
    .eq("cod_hold", true)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(80);
  return ((data as any[]) ?? [])
    .filter((o) => isCodOrder(o) && String(o.status ?? "").toLowerCase() !== "cancelled")
    .slice(0, limit) as PendingCodOrderRow[];
}
