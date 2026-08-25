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

/** Re-open a held/denied estimate. Releasing any reserved stock back to sellable (no-op if none held). */
export async function reopenEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  await sb.from("estimates").update({ status: "open" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

/** Park an estimate ON HOLD and RESERVE its stock. */
export async function holdEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const { error } = await supabaseServer().rpc("hold_estimate", { p_estimate_id: id });
  if (error) redirect(`/admin/estimates?holderror=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

/** Convert a backorder into a fulfilled sale once stock has arrived. */
export async function fulfillBackorderAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const { error } = await supabaseServer().rpc("fulfill_backorder", { p_order_id: id });
  revalidatePath("/admin/backorders"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  if (!error) revalidateTag("storefront");
  if (error) redirect(`/admin/backorders?err=${encodeURIComponent(error.message)}`);
  redirect("/admin/backorders?ok=1");
}

/** Confirm a held COD order once dispatched AND customer has received/paid. */
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

/** Cancel a held COD order (customer refused / didn't confirm). */
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

/** EDIT a line on an OPEN (pending) backorder. */
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
