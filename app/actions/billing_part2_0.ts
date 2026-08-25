"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";
export async function confirmCodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  const { data: o } = await sb.from("orders").select("payment_mode,cod_hold,amount_paid,total").eq("id", id).maybeSingle();
  if (!o || (o as any).cod_hold !== true || !isCodOrder(o as any)) {
    redirect("/admin/cod?err=" + encodeURIComponent("That order is prepaid — accept or reject it under Storefront Orders, not COD."));
  }
  const { error } = await sb.rpc("confirm_cod_order", { p_order_id: id });
  revalidatePath("/admin/cod"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  if (!error) revalidateTag("storefront");
  if (error) redirect(`/admin/cod?err=${encodeURIComponent(error.message)}`);
  redirect("/admin/cod?ok=1");
}

/** Cancel a held COD order (customer refused / didn't confirm). It held NO stock and NO revenue, so we
 *  simply delete it — there is nothing to restock or reverse. */
export async function cancelCodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  const { data: o } = await sb.from("orders").select("payment_mode,cod_hold,amount_paid,total").eq("id", id).maybeSingle();
  if (!o || (o as any).cod_hold !== true || !isCodOrder(o as any)) {
    redirect("/admin/cod?err=" + encodeURIComponent("That order is prepaid — reject it under Storefront Orders. Do not cancel it from COD."));
  }
  await sb.from("order_items").delete().eq("order_id", id).then(() => {}, () => {});
  await sb.from("orders").delete().eq("id", id).then(() => {}, () => {});
  revalidatePath("/admin/cod"); revalidatePath("/admin/dashboard");
  redirect("/admin/cod?cancelled=1");
}

/**
 * EDIT a line on an OPEN (pending) backorder — change its quantity or remove it. This is safe and
 * needs NO stock/ledger reconciliation: a pending backorder is held like an estimate (it hasn't moved
 * inventory or posted revenue yet), so we only touch order_items and re-total the bill. When the owner
 * later hits "Convert to sale", the corrected quantities are what move stock and post revenue.
 * (A wrong entry on a FULFILLED bill isn't editable here — that would need a return; guarded below.)
 */
export async function updateBackorderLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const orderId = String(formData.get("order_id") ?? "").trim();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const remove = String(formData.get("remove") ?? "") === "1";
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  if (!orderId || !itemId) return;
  const sb = supabaseServer();
  const { data: o } = await sb.from("orders").select("is_backorder,extra_packing,extra_courier,extra_adjustment").eq("id", orderId).maybeSingle();
  if (!(o as any)?.is_backorder) { revalidatePath("/admin/backorders"); return; }
  if (remove || qty <= 0) {
    await sb.from("order_items").delete().eq("id", itemId).eq("order_id", orderId);
  } else {
    const { data: it } = await sb.from("order_items").select("unit_price").eq("id", itemId).eq("order_id", orderId).maybeSingle();
    if (it) await sb.from("order_items").update({ qty, line_total: ((it as any).unit_price ?? 0) * qty }).eq("id", itemId);
  }
  const { data: lines } = await sb.from("order_items").select("line_total").eq("order_id", orderId);
  const items = ((lines as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  const charges = (((o as any).extra_packing) || 0) + (((o as any).extra_courier) || 0) + (((o as any).extra_adjustment) || 0);
  await sb.from("orders").update({ total: items + charges }).eq("id", orderId);
  revalidatePath("/admin/backorders"); revalidatePath(`/admin/invoice/${orderId}`);
}

type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; status: string; customer_name: string | null;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

/** Load a bill + its lines for the OTP-gated "edit bill" dialog. */
export async function fetchOrderForEditAction(orderId: string): Promise<{ ok: boolean; error?: string; bill?: EditableBill }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const id = (orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing bill" };
  const sb = supabaseServer();
  const { data, error } = await sb.from("orders")
    .select("id,invoice_no,total,amount_paid,is_backorder,status, order_items(id,qty,unit_price,line_total, product:products(name,sku), variant:variants(sku,color))")
    .eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Bill not found" };
  const o = data as any;
  return { ok: true, bill: {
    id: o.id, invoice_no: o.invoice_no ?? null, total: o.total ?? 0, amount_paid: o.amount_paid ?? 0,
    is_backorder: !!o.is_backorder, status: o.status ?? "",
    customer_name: o.customer_name ?? null,
    items: ((o.order_items as any[]) ?? []).map((it) => ({
      id: it.id,
      sku: (it.variant?.sku ?? it.product?.sku ?? "") as string,
      name: `${it.product?.name ?? ""}${it.variant?.color ? " · " + it.variant.color : ""}`,
      qty: it.qty ?? 0, unit_price: it.unit_price ?? 0, line_total: it.line_total ?? (it.unit_price ?? 0) * (it.qty ?? 0),
    })) } };
}

/** OTP-gated edit of ONE line on an existing bill (fix a mistake without cancelling the whole bill).
 *  The RPC keeps stock, revenue and the total correct. The owner's OTP protects it so staff can't
 *  quietly rewrite a completed sale. Set newQty=0 to remove the line. */
export async function editOrderLineAction(input: { orderId: string; itemId: string; newQty: number; otp: string }): Promise<{ ok: boolean; error?: string; total?: number; removed?: boolean }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const otp = (input.otp ?? "").trim();
  if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  const orderId = (input.orderId ?? "").trim();
  const itemId = (input.itemId ?? "").trim();
  if (!orderId || !itemId) return { ok: false, error: "Missing bill / line." };
  const newQty = Math.max(0, Math.floor(Number(input.newQty ?? 0)));
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("edit_order_line", { p_order_id: orderId, p_item_id: itemId, p_new_qty: newQty });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales"); revalidatePath("/admin/backorders"); revalidatePath("/admin/dashboard");
  return { ok: true, total: (data as any)?.total, removed: (data as any)?.removed };
}
