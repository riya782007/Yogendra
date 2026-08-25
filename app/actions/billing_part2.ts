"use server";
import { revalidateTag, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export async function denyEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.deny"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  await sb.from("estimates").update({ status: "denied" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

export async function reopenEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  await sb.from("estimates").update({ status: "open" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

export async function holdEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const { error } = await supabaseServer().rpc("hold_estimate", { p_estimate_id: id });
  if (error) redirect(`/admin/estimates?holderror=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

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
