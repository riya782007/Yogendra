"use server";
/** Owner housekeeping for the Abandoned Carts list — remove rows that aren't worth chasing. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { placeWholesaleOrderFromCartAction } from "@/app/actions/wholesale";
import { phoneDigits } from "@/lib/phone";

/** Delete ONE abandoned-cart row (owner decides it's irrelevant — anonymous, tiny, spammy, etc.). */
export async function deleteAbandonedCartAction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "not permitted" };
  const clean = String(id ?? "").trim();
  if (!clean) return { ok: false, error: "Missing cart id." };
  const { error } = await supabaseServer().from("abandoned_carts").delete().eq("id", clean);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/abandoned");
  return { ok: true };
}

/** Clear ALL anonymous carts with no phone number in one go — the ones the owner can never act on. */
export async function clearAnonymousCartsAction(): Promise<{ ok: boolean; removed?: number; error?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "not permitted" };
  const sb = supabaseServer();
  // No phone AND not recovered = a dead lead. Keep anything with a contact number or already recovered.
  const { data, error } = await sb.from("abandoned_carts")
    .delete()
    .or("phone.is.null,phone.eq.")
    .neq("recovered", true)
    .select("id");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/abandoned");
  return { ok: true, removed: ((data as any[]) ?? []).length };
}

/**
 * Owner takes a visitor/buyer cart on a call and bills it — even when they are NOT a created
 * wholesale customer (US retail shopper who only left a phone). Wholesale carts still go through
 * the dealer RPC when an approved dealer matches; otherwise we ring it as a POS retail bill.
 */
export async function placeOrderFromCartAction(input: {
  sessionId?: string; cartId?: string; markPaid?: boolean;
}): Promise<{ ok: boolean; error?: string; orderId?: string; total?: number }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't place orders." };
  const sid = (input.sessionId ?? "").trim();
  const cartId = (input.cartId ?? "").trim();
  if (!sid && !cartId) return { ok: false, error: "Missing cart." };
  const sb = supabaseServer();
  let cart: any = null;
  if (sid) {
    const { data } = await sb.from("abandoned_carts").select("*").eq("session_id", sid).maybeSingle();
    cart = data;
  }
  if (!cart && cartId) {
    const { data } = await sb.from("abandoned_carts").select("*").eq("id", cartId).maybeSingle();
    cart = data;
  }
  if (!cart) return { ok: false, error: "Cart not found (maybe already ordered)." };
  if (cart.recovered) return { ok: false, error: "This cart was already billed." };

  const channel = String(cart.channel ?? "").toLowerCase();
  const sessionId = String(cart.session_id ?? sid);
  if (channel === "wholesale" && sessionId) {
    const w = await placeWholesaleOrderFromCartAction({ sessionId, markPaid: input.markPaid });
    if (w.ok) return w;
    // No dealer on file — fall through and bill as retail so a US/guest trade visitor can still be fulfilled.
    if (!String(w.error ?? "").includes("No approved wholesale dealer")) return w;
  }

  const items = (((cart.items as any[]) ?? []).filter((i: any) => i?.sku && Number(i?.qty) > 0) as any[])
    .map((i) => ({
      sku: String(i.sku),
      qty: Math.floor(Number(i.qty)),
      color: i.color ? String(i.color) : undefined,
    }));
  if (!items.length) return { ok: false, error: "This cart has no billable items." };
  if (phoneDigits(cart.phone).length < 7) return { ok: false, error: "This cart has no phone — add the number, then bill." };

  const customer = {
    name: String(cart.customer_name || "").trim() || "Walk-in",
    phone: String(cart.phone || "").trim(),
  };
  const { data, error } = await sb.rpc("place_order", {
    p_items: items,
    p_customer: customer,
    p_channel: "pos",
    p_payment: input.markPaid ? "cash" : "upi",
    p_allow_oversell: false,
    p_tier: "retail",
  });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id as string | undefined;
  const total = (data as any)?.total as number | undefined;
  if (orderId) {
    await sb.rpc("assign_invoice_no", { p_order: orderId }).then(() => {}, () => {});
    const note = "Placed by owner from visitor cart (phone order)";
    await sb.from("orders").update({
      admin_note: note,
      ...(input.markPaid && total ? { amount_paid: total } : {}),
    }).eq("id", orderId).then(() => {}, () => {});
  }
  await sb.from("abandoned_carts").update({ recovered: true }).eq("id", cart.id).then(() => {}, () => {});
  revalidatePath("/admin/abandoned");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  return { ok: true, orderId, total };
}
