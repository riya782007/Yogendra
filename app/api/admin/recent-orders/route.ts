import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOrderAlertsWithPayment } from "@/lib/orderAlerts";

export const dynamic = "force-dynamic";

// Lightweight endpoint the dashboard polls to show new orders live + toast on arrival.
// Uses payment_mode so COD vs PREPAID is labelled correctly in the live panel.
export async function GET() {
  const s = getSession();
  if (!s.authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const data = await getOrderAlertsWithPayment(8);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ orders: [], last24h: 0 });
  }
}
