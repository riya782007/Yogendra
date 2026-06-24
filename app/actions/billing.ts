"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

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
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("convert_estimate_v2", { p_estimate_id: id, p_bill_type: billType });
  if (error) throw new Error(error.message);
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
