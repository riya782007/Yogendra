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
    const city = (body?.city ?? "").toString().trim().slice(0, 80) || null;
    const channel = (body?.channel ?? "").toString().trim().toLowerCase() === "wholesale" ? "wholesale" : "retail";

    const jar = cookies();
    let sid = jar.get(SID)?.value;
    if (!sid) {
      sid = randomUUID();
      jar.set(SID, sid, { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 24 * 30 });
    }

    const sb = supabaseServer();
    // An empty payload clears the stored row ONLY when the client explicitly asks for it.
    //
    // It used to delete on ANY empty cart. The bd_cart_sid cookie lives 30 days, and the wholesale
    // tracker fires on mount while `qty` is still empty - so simply RE-OPENING the trade catalogue
    // POSTed an empty cart and wiped the cart that dealer had saved on an earlier visit. The carts the
    // owner most wanted were exactly the ones that disappeared, with no error and no log anywhere.
    // (Owner, 24-25 Sep 2026: Neha's cart, and Ruchika's after she reached the payment screen.)
    if (!items.length || total <= 0) {
      if (body?.clear === true) {
        await sb.from("abandoned_carts").delete().eq("session_id", sid);
        return NextResponse.json({ ok: true, cleared: true });
      }
      return NextResponse.json({ ok: true, ignored: "empty" });
    }

    /**
     * CART LINE CAP - owner, 23 Sep 2026: a wholesale cart printed a total its own lines did not add
     * up to. The list showed 50 items worth Rs 16,764.28 under a heading of Rs 21,172.68.
     *
     * Cause: this cap used to be 50, and `total` below is taken from the browser, where it is summed
     * over the WHOLE cart. So a dealer with more than 50 lines had the extra ones silently dropped
     * while their value stayed in the total. The total was right; the itemisation was short. Eight
     * carts had already hit it, Rs 77,855 of cart value sitting in totals with no lines behind it -
     * and the WhatsApp recovery message quotes the stored item COUNT next to that full total, so
     * dealers were being told "50 pieces (Rs 21,172.68)".
     *
     * 200 is comfortably past any real dealer cart (the biggest seen is ~60) while still bounding
     * what a script could push into the row. If it is ever hit, items_dropped records it rather than
     * letting the shortfall pass unnoticed - `total` deliberately still covers the whole cart.
     */
    const MAX_TRACKED_ITEMS = 200;
    const clean = items.slice(0, MAX_TRACKED_ITEMS).map((i: any) => ({
      sku: (i?.sku ?? "").toString().slice(0, 60),
      name: (i?.name ?? "").toString().slice(0, 160),
      qty: Math.max(1, Math.round(Number(i?.qty) || 1)),
      price: Math.max(0, Math.round(Number(i?.price) || 0)),
    }));

    // When the shopper opens the payment step, flag it so the owner is informed IMMEDIATELY (a dealer
    // who reached "Pay to confirm" has finalised — the owner can call/close it, esp. international ones)
    // instead of waiting for the 20-min "abandoned" window.
    const reachedCheckout = String(body?.stage ?? "").toLowerCase() === "checkout" || body?.reachedCheckout === true;
    const itemsDropped = Math.max(0, items.length - clean.length);
    const row: any = { session_id: sid, items: clean, total, customer_name: name, phone, recovered: false, channel, items_dropped: itemsDropped, updated_at: new Date().toISOString() };
    if (city) row.city = city;
    if (reachedCheckout) row.reached_checkout = true;
    let up = await sb.from("abandoned_carts").upsert(row, { onConflict: "session_id" });
    if (up.error) {
      // `channel`/`city`/`items_dropped` columns may not be deployed yet — retry without them so
      // tracking never breaks on an older database.
      delete row.channel; delete row.city; delete row.items_dropped;
      up = await sb.from("abandoned_carts").upsert(row, { onConflict: "session_id" });
    }
    if (up.error) {
      // Last resort: `reached_checkout` may be missing too, and it was never stripped. On a database
      // without that column EVERY cart that reached the payment screen failed both attempts and was
      // dropped in silence - the highest-intent carts of all.
      delete row.reached_checkout;
      up = await sb.from("abandoned_carts").upsert(row, { onConflict: "session_id" });
    }
    if (up.error) {
      // Never break the storefront - but never lose a cart silently either. This line is the only
      // trace a failed save leaves; without it a missing cart can only be reconstructed from the
      // owner's WhatsApp screenshots.
      console.error("[cart/track] could not save cart", { sid, lines: clean.length, total, error: up.error.message });
      return NextResponse.json({ ok: false, saved: false });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Never break the storefront over analytics.
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
