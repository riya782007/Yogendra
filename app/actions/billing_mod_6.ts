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

export async function recordReturnAction(input: { orderId: string; reason: string; items: { product_id: string; variantSku?: string; qty: number }[] }): Promise<{ ok: boolean; qty?: number; error?: string; pending?: boolean }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns/refunds." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Capture a return reason" };
  const sb = supabaseServer();

  if (!getSession().isOwner) {
    await sb.from("approvals").insert({
      action: "sales_return",
      payload: { orderId: input.orderId, reason: input.reason, items: input.items.map((i) => ({ product_id: i.product_id, qty: i.qty, variantSku: i.variantSku ?? null })) },
      status: "pending",
      otp_hash: `h:${OWNER_OTP()}`,
    });
    revalidatePath("/admin/approvals");
    return { ok: true, pending: true };
  }

  const skus = [...new Set(input.items.map((i) => (i.variantSku ?? "").trim()).filter(Boolean))];
  const vBySku = new Map<string, string>();
  if (skus.length) {
    const { data: vs } = await sb.from("variants").select("id,sku").in("sku", skus);
    for (const v of ((vs as any[]) ?? [])) vBySku.set(String(v.sku).toUpperCase(), v.id);
  }
  const p_items = input.items.map((i) => ({ product_id: i.product_id, qty: i.qty, variant_id: i.variantSku ? (vBySku.get(i.variantSku.toUpperCase()) ?? null) : null }));
  const { data, error } = await sb.rpc("record_sales_return", { p_order_id: input.orderId, p_reason: input.reason, p_items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/returns"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/sales");
  revalidatePath("/admin/stock-movements"); revalidatePath("/admin/catalogue"); revalidatePath("/admin/inventory");
  revalidatePath("/admin/creditors"); revalidatePath("/shop"); revalidateTag("storefront"); revalidatePath("/admin/customers");
  return { ok: true, qty: (data as any)?.qty };
}

export async function cancelOrderAction(orderId: string, reason?: string): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  if (!getSession().isOwner) return { ok: false, error: "Only the owner can cancel an order." };
  if (!orderId) return { ok: false, error: "Missing order." };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("cancel_order", { p_order_id: orderId, p_reason: (reason ?? "").trim() || "Cancelled" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/sales"); revalidatePath("/admin/backorders"); revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/invoice/${orderId}`);
  return { ok: true, already: !!(data as any)?.already };
}

export async function listReceiveAccountsAction(): Promise<{ id: string; name: string; kind: string; upiId: string | null; isDefault: boolean }[]> {
  const { data } = await supabaseServer().from("payment_methods").select("id,name,kind,upi_id,is_default,sort").eq("active", true).order("sort").order("name");
  return ((data as any[]) ?? []).map((m) => ({ id: m.id, name: m.name, kind: m.kind, upiId: m.upi_id ?? null, isDefault: !!m.is_default }));
}
