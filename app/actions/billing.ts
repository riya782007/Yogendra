"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";

/** Recompute an estimate's total from its current line items. */
async function recomputeEstimateTotal(sb: ReturnType<typeof supabaseServer>, estimateId: string) {
  const { data } = await sb.from("estimate_items").select("line_total").eq("estimate_id", estimateId);
  const total = ((data as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  await sb.from("estimates").update({ total }).eq("id", estimateId);
}

/** #18: edit an open estimate — customer details. */
export async function updateEstimateCustomerAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("customer_name") ?? "").trim() || null;
  const phone = String(formData.get("customer_phone") ?? "").trim() || null;
  await supabaseServer().from("estimates").update({ customer_name: name, customer_phone: phone }).eq("id", id);
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
  revalidatePath(`/admin/estimate/${estimateId}`);
}

/** Pillar 4/15: edit a line's UNIT PRICE (₹) on an open estimate — the negotiated rate
 *  is stored and carries straight through to the final bill on conversion. */
export async function updateEstimateLinePriceAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  const rupees = Number(formData.get("price") ?? 0);
  if (!itemId || !estimateId || !Number.isFinite(rupees) || rupees < 0) return;
  const unit = Math.round(rupees * 100); // store paise
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
  revalidatePath(`/admin/estimate/${estimateId}`);
}

/** #18: add a line (by SKU, at the current retail price) to an open estimate. */
export async function addEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const estimateId = String(formData.get("estimate_id") ?? "");
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const qty = Math.max(1, Math.floor(Number(formData.get("qty") ?? 1)));
  if (!estimateId || !sku) return;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,base_wholesale,wholesale_override,retail_override,mrp_override").ilike("sku", sku).maybeSingle();
  if (!p) return;
  const formula = await getPricingFormula();
  const unit = resolvePrices((p as any).base_wholesale, formula, overridesOf(p)).retailPrice;
  await sb.from("estimate_items").insert({ estimate_id: estimateId, product_id: (p as any).id, qty, unit_price: unit, line_total: unit * qty });
  await recomputeEstimateTotal(sb, estimateId);
  revalidatePath(`/admin/estimate/${estimateId}`);
}

export async function createEstimateAction(input: { items: { sku: string; qty: number }[]; customer: { name?: string; phone?: string } }): Promise<{ ok: boolean; estimateId?: string; total?: number; error?: string }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't create estimates." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("create_estimate", { p_items: input.items, p_customer: input.customer ?? {} });
  if (error) return { ok: false, error: error.message };
  const estimateId = (data as any)?.estimate_id;
  // The RPC stores only the name; persist the phone too.
  if (estimateId && input.customer?.phone) await sb.from("estimates").update({ customer_phone: input.customer.phone }).eq("id", estimateId);
  revalidatePath("/admin/estimates");
  return { ok: true, estimateId, total: (data as any)?.total };
}

export async function convertEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().rpc("convert_estimate", { p_estimate_id: id });
  revalidatePath("/admin/estimates"); revalidatePath("/admin/dashboard");
}

/**
 * Bill an estimate. p_bill_type "gst" → tax invoice, "cash" → cash memo.
 * Decrements stock, posts to the ledger, links the order, then opens the bill.
 */
export async function billEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) redirect("/admin/estimates");
  const id = String(formData.get("id"));
  const billType = String(formData.get("bill_type") ?? "gst") === "cash" ? "cash" : "gst";
  const allowOversell = String(formData.get("allow_oversell") ?? "") === "1";
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("convert_estimate_v2", { p_estimate_id: id, p_bill_type: billType, p_allow_oversell: allowOversell });
  // Insufficient-stock (or any) error: bounce back to the estimate with a clear message
  // instead of throwing a server error page.
  if (error) redirect(`/admin/estimate/${id}?billerror=${encodeURIComponent(error.message)}`);
  const orderId = (data as any)?.order_id;
  if (orderId) await sb.rpc("assign_invoice_no", { p_order: orderId });
  revalidatePath("/admin/estimates"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/sales");
  if (orderId) redirect(`/admin/invoice/${orderId}`);
  redirect("/admin/estimates");
}

/** Mark an estimate as denied (customer did not want the products). */
export async function denyEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.deny"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("estimates").update({ status: "denied" }).eq("id", id);
  revalidatePath("/admin/estimates");
}

/** Re-open a held/denied estimate. */
export async function reopenEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("estimates").update({ status: "open" }).eq("id", id);
  revalidatePath("/admin/estimates");
}

export async function recordReturnAction(input: { orderId: string; reason: string; items: { product_id: string; qty: number }[] }): Promise<{ ok: boolean; qty?: number; error?: string }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns/refunds." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Capture a return reason" };
  const { data, error } = await supabaseServer().rpc("record_sales_return", { p_order_id: input.orderId, p_reason: input.reason, p_items: input.items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/returns"); revalidatePath("/admin/dashboard");
  return { ok: true, qty: (data as any)?.qty };
}
