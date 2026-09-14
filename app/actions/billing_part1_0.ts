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
/** Recompute an estimate's total from its current line items. */
export async function recomputeEstimateTotal(sb: ReturnType<typeof supabaseServer>, estimateId: string) {
  const { data } = await sb.from("estimate_items").select("line_total").eq("estimate_id", estimateId);
  const items = ((data as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  let charges = 0;
  const { data: est } = await sb.from("estimates").select("*").eq("id", estimateId).maybeSingle();
  if (est) {
    const e = est as any;
    charges = (e.extra_packing || 0) + (e.extra_courier || 0) + (e.extra_adjustment || 0)
            + (e.extra_tcs || 0) - (e.extra_discount || 0);
  }
  await sb.from("estimates").update({ total: Math.max(0, items + charges) }).eq("id", estimateId);
}

/** #18: edit an open estimate — customer details. */
export async function updateEstimateCustomerAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("customer_name") ?? "").trim() || null;
  const phone = String(formData.get("customer_phone") ?? "").trim() || null;
  const gstin = String(formData.get("buyer_gstin") ?? "").trim().toUpperCase() || null;
  const address = String(formData.get("buyer_address") ?? "").trim() || null;
  const email = String(formData.get("buyer_email") ?? "").trim() || null;
  const shipName = String(formData.get("ship_to_name") ?? "").trim() || null;
  const shipAddr = String(formData.get("ship_to_address") ?? "").trim() || null;
  const patch: any = {
    customer_name: name, customer_phone: phone, buyer_gstin: gstin, buyer_address: address,
    buyer_email: email, ship_to_name: shipName, ship_to_address: shipAddr,
  };
  let res = await (supabaseServer().from("estimates") as any).update(patch).eq("id", id);
  if (res.error) {
    await supabaseServer().from("estimates").update({ customer_name: name, customer_phone: phone }).eq("id", id);
  }
  revalidatePath(`/admin/estimate/${id}`);
}

/** Discount / packing / shipping / TCS / adjustment on an open estimate. Rupees in, paise stored. */
export async function updateEstimateChargesAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const paise = (k: string) => Math.round((Number(formData.get(k) ?? 0) || 0) * 100);
  const patch: any = {
    extra_discount: Math.max(0, paise("discount")),
    extra_packing: Math.max(0, paise("packing")),
    extra_courier: Math.max(0, paise("courier")),
    extra_tcs: Math.max(0, paise("tcs")),
    extra_adjustment: paise("adjustment"),
  };
  const sb = supabaseServer();
  const res = await (sb.from("estimates") as any).update(patch).eq("id", id);
  if (!res.error) await recomputeEstimateTotal(sb, id);
  revalidatePath(`/admin/estimate/${id}`);
}

/** Choose how an estimate is quoted: with GST (inclusive/exclusive) or as a plain no-tax estimate. */
export async function setEstimateGstAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const choice = String(formData.get("tax") ?? "exclusive");
  const patch: any = choice === "none"
    ? { gst: false }
    : { gst: true, gst_mode: choice === "inclusive" ? "inclusive" : "exclusive" };
  const res = await (supabaseServer().from("estimates") as any).update(patch).eq("id", id);
  if (res.error) await supabaseServer().from("estimates").update({ gst: choice !== "none" }).eq("id", id);
  revalidatePath(`/admin/estimate/${id}`);
}

/** #18: change a line's quantity on an open estimate. */
export async function updateEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  const qty = Math.max(1, Math.floor(Number(formData.get("qty") ?? 1)));
  if (!itemId || !estimateId) return;
  const sb = supabaseServer();
  const { data: it } = await sb.from("estimate_items").select("unit_price").eq("id", itemId).maybeSingle();
  if (!it) return;
  await sb.from("estimate_items").update({ qty, line_total: (it as any).unit_price * qty }).eq("id", itemId);
  await recomputeEstimateTotal(sb, estimateId);
  await sb.rpc("resync_estimate_hold", { p_estimate_id: estimateId });
  revalidatePath(`/admin/estimate/${estimateId}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}

/** Pillar 4/15: edit a line's UNIT PRICE (₹) on an open estimate — the negotiated rate
 *  is stored and carries straight through to the final bill on conversion. */
export async function updateEstimateLinePriceAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  const rupees = Number(formData.get("price") ?? 0);
  if (!itemId || !estimateId || !Number.isFinite(rupees) || rupees < 0) return;
  const unit = Math.round(rupees * 100);
  const sb = supabaseServer();
  const { data: it } = await sb.from("estimate_items").select("qty").eq("id", itemId).maybeSingle();
  if (!it) return;
  await sb.from("estimate_items").update({ unit_price: unit, line_total: unit * (it as any).qty }).eq("id", itemId);
  await recomputeEstimateTotal(sb, estimateId);
  revalidatePath(`/admin/estimate/${estimateId}`);
}

/** #18: remove a line from an open estimate. */
export async function removeEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!itemId || !estimateId) return;
  const sb = supabaseServer();
  await sb.from("estimate_items").delete().eq("id", itemId);
  await recomputeEstimateTotal(sb, estimateId);
  await sb.rpc("resync_estimate_hold", { p_estimate_id: estimateId });
  revalidatePath(`/admin/estimate/${estimateId}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}

type PosItem = { sku: string; name: string; price: number; wholesale: number; mrp: number; category: string; qty: number; parentSku?: string; parentName?: string };
