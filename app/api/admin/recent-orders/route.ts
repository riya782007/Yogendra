import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getOrderAlerts } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

// Lightweight endpoint the dashboard polls to show new orders live + toast on arrival.
export async function GET() {
  const s = getSession();
  if (!s.authed) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const data = await getOrderAlerts(8);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ orders: [], last24h: 0 });
  }
}
