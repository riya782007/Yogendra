import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomUUID } from "crypto";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SID = "bd_cart_sid";

/**
 * Records the shopper's live cart so unfinished ones surface on the admin Abandoned Carts page.
 * Called (fire-and-forget) whenever the cart changes. One row per browser session (cookie SID),
 * upserted; an empty cart deletes the row; a placed order marks it recovered elsewhere.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body?.items) ? body.items : [];
    const total = Math.max(0, Math.round(Number(body?.total) || 0));
    const name = (body?.name ?? "").toString().trim().slice(0, 120) || null;
    const phone = (body?.phone ?? "").toString().replace(/[^\d+]/g, "").slice(0, 20) || null;

    const jar = cookies();
    let sid = jar.get(SID)?.value;
    if (!sid) {
      sid = randomUUID();
      jar.set(SID, sid, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30 });
    }

    const sb = supabaseServer();
    // Empty cart → clear any stored row (they emptied it, not abandoned).
    if (!items.length || total <= 0) {
      await sb.from("abandoned_carts").delete().eq("session_id", sid);
      return NextResponse.json({ ok: true, cleared: true });
    }

    const clean = items.slice(0, 50).map((i: any) => ({
      sku: (i?.sku ?? "").toString().slice(0, 60),
      name: (i?.name ?? "").toString().slice(0, 160),
      qty: Math.max(1, Math.round(Number(i?.qty) || 1)),
      price: Math.max(0, Math.round(Number(i?.price) || 0)),
    }));

    await sb.from("abandoned_carts").upsert(
      { session_id: sid, items: clean, total, customer_name: name, phone, recovered: false, updated_at: new Date().toISOString() },
      { onConflict: "session_id" },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Never break the storefront over analytics.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
