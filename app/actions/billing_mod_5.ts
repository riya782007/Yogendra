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

type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; status: string; customer_name: string | null;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

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

export async function addOrderLineAction(input: { orderId: string; sku: string; qty: number; priceRupees?: number; otp: string }): Promise<{ ok: boolean; error?: string; total?: number; sku?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const otp = (input.otp ?? "").trim();
  if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  const orderId = (input.orderId ?? "").trim();
  const sku = (input.sku ?? "").trim();
  if (!orderId || !sku) return { ok: false, error: "Enter the SKU to add." };
  const qty = Math.max(1, Math.floor(Number(input.qty ?? 1)));

  const sb = supabaseServer();
  const formula = await getPricingFormula();

  const { data: ord } = await sb.from("orders").select("channel,bill_type").eq("id", orderId).maybeSingle();
  const wholesale = String((ord as any)?.channel ?? "").toLowerCase() === "wholesale";

  const { data: v } = await sb.from("variants")
    .select("id,sku,product_id,retail_override,wholesale_override,mrp_override, product:products(id,sku,base_wholesale,retail_override,wholesale_override,mrp_override)")
    .ilike("sku", sku).maybeSingle();
  let productId: string | null = null, variantId: string | null = null, base = 0, vOv: any = {}, pOv: any = {};
  if (v) {
    const p = (v as any).product;
    productId = p?.id ?? (v as any).product_id; variantId = (v as any).id;
    base = p?.base_wholesale ?? 0; vOv = overridesOf(v); pOv = overridesOf(p ?? {});
  } else {
    const { data: p } = await sb.from("products")
      .select("id,sku,base_wholesale,retail_override,wholesale_override,mrp_override, variants(id,sku)")
      .ilike("sku", sku).maybeSingle();
    if (!p) return { ok: false, error: `No product “${sku}” — check the SKU.` };
    const vs = ((p as any).variants as any[]) ?? [];
    if (vs.length > 1) return { ok: false, error: `“${sku}” has ${vs.length} colours — enter the exact colour SKU (e.g. ${vs[0].sku}).` };
    productId = (p as any).id; variantId = vs.length === 1 ? vs[0].id : null;
    base = (p as any).base_wholesale ?? 0; pOv = overridesOf(p);
  }

  const pr = resolvePrices(base, formula, vOv, pOv);
  const typed = Number(input.priceRupees);
  const unitPrice = Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100) : (wholesale ? pr.wholesaleRate : pr.retailPrice);

  const { data, error } = await sb.rpc("add_order_line", {
    p_order_id: orderId, p_product_id: productId, p_variant_id: variantId,
    p_qty: qty, p_unit_price: unitPrice, p_unit_mrp: pr.mrp ?? null, p_allow_oversell: false,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/stock-movements");
  return { ok: true, total: (data as any)?.total, sku: (data as any)?.sku };
}

export async function fetchOrderForReturnAction(orderId: string): Promise<{ ok: boolean; error?: string; order?: { id: string; total: number; customer_name: string | null; created_at: string; items: { qty: number; returned: number; returnable: number; product: { id: string; name: string; sku: string }; variant: { sku: string; color: string | null } | null }[] } }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns." };
  const id = (orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing order" };
  const sb2 = supabaseServer();
  const { data, error } = await sb2.from("orders")
    .select("id,total,customer_name,created_at, order_items(qty, variant_id, product:products(id,name,sku), variant:variants(id,sku,color))")
    .eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Order not found" };
  const o = data as any;
  const { data: rets } = await sb2.from("stock_adjustments")
    .select("product_id,variant_id,delta").eq("ref_id", id).eq("kind", "return");
  const retBy = new Map<string, number>();
  for (const r of ((rets as any[]) ?? [])) {
    const k = `${r.product_id}::${r.variant_id ?? ""}`;
    retBy.set(k, (retBy.get(k) ?? 0) + (r.delta ?? 0));
  }
  return { ok: true, order: { id: o.id, total: o.total ?? 0, customer_name: o.customer_name ?? null, created_at: o.created_at,
    items: ((o.order_items as any[]) ?? []).map((it) => {
      const returned = retBy.get(`${it.product?.id}::${it.variant_id ?? ""}`) ?? 0;
      return { qty: it.qty ?? 0, returned, returnable: Math.max(0, (it.qty ?? 0) - returned), product: it.product, variant: it.variant ?? null };
    }) } };
}
