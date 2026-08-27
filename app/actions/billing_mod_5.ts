"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";
import { orderStoredTotalPaise, billTypeFromTax, gstModeFromTax, type BillTax } from "@/lib/orderBill";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; cod_hold: boolean; status: string; channel: string | null;
  bill_type: string | null; gst_mode: string | null;
  customer_name: string | null; customer_phone: string | null;
  buyer_gstin: string | null; buyer_address: string | null;
  extra_packing: number; extra_courier: number; extra_adjustment: number;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

function mapEditableBill(o: any): EditableBill {
  return {
    id: o.id, invoice_no: o.invoice_no ?? null, total: o.total ?? 0, amount_paid: o.amount_paid ?? 0,
    is_backorder: !!o.is_backorder, cod_hold: !!o.cod_hold, status: o.status ?? "",
    channel: o.channel ?? null, bill_type: o.bill_type ?? null, gst_mode: o.gst_mode ?? null,
    customer_name: o.customer_name ?? null, customer_phone: o.customer_phone ?? null,
    buyer_gstin: o.buyer_gstin ?? null, buyer_address: o.buyer_address ?? null,
    extra_packing: o.extra_packing ?? 0, extra_courier: o.extra_courier ?? 0, extra_adjustment: o.extra_adjustment ?? 0,
    items: ((o.order_items as any[]) ?? []).map((it: any) => ({
      id: it.id,
      sku: (it.variant?.sku ?? it.product?.sku ?? "") as string,
      name: `${it.product?.name ?? ""}${it.variant?.color ? " · " + it.variant.color : ""}`,
      qty: it.qty ?? 0, unit_price: it.unit_price ?? 0, line_total: it.line_total ?? (it.unit_price ?? 0) * (it.qty ?? 0),
    })),
  };
}

const EDIT_BILL_SELECT = "id,invoice_no,total,amount_paid,is_backorder,cod_hold,status,channel,bill_type,gst_mode,customer_name,customer_phone,buyer_gstin,buyer_address,extra_packing,extra_courier,extra_adjustment, order_items(id,qty,unit_price,line_total, product:products(name,sku), variant:variants(sku,color))";

/** Load a bill + its lines for the full "edit like create-bill" screen. */
export async function fetchOrderForEditAction(orderId: string): Promise<{ ok: boolean; error?: string; bill?: EditableBill }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const id = (orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing bill" };
  const sb = supabaseServer();
  const { data, error } = await sb.from("orders").select(EDIT_BILL_SELECT).eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Bill not found" };
  return { ok: true, bill: mapEditableBill(data) };
}

async function resolveSkuForBill(sb: ReturnType<typeof supabaseServer>, skuRaw: string): Promise<{
  ok: true; productId: string; variantId: string | null; retail: number; wholesale: number; mrp: number | null; sku: string;
} | { ok: false; error: string }> {
  const sku = skuRaw.trim();
  if (!sku) return { ok: false, error: "Enter a SKU." };
  const formula = await getPricingFormula();
  const { data: v } = await sb.from("variants")
    .select("id,sku,product_id,retail_override,wholesale_override,mrp_override, product:products(id,sku,base_wholesale,retail_override,wholesale_override,mrp_override)")
    .ilike("sku", sku).maybeSingle();
  let productId: string | null = null, variantId: string | null = null, base = 0, vOv: any = {}, pOv: any = {};
  let resolvedSku = sku;
  if (v) {
    const p = (v as any).product;
    productId = p?.id ?? (v as any).product_id; variantId = (v as any).id;
    base = p?.base_wholesale ?? 0; vOv = overridesOf(v); pOv = overridesOf(p ?? {});
    resolvedSku = (v as any).sku ?? sku;
  } else {
    const { data: p } = await sb.from("products")
      .select("id,sku,base_wholesale,retail_override,wholesale_override,mrp_override, variants(id,sku)")
      .ilike("sku", sku).maybeSingle();
    if (!p) return { ok: false, error: `No product “${sku}” — check the SKU.` };
    const vs = ((p as any).variants as any[]) ?? [];
    if (vs.length > 1) return { ok: false, error: `“${sku}” has ${vs.length} colours — enter the exact colour SKU (e.g. ${vs[0].sku}).` };
    productId = (p as any).id; variantId = vs.length === 1 ? vs[0].id : null;
    base = (p as any).base_wholesale ?? 0; pOv = overridesOf(p);
    resolvedSku = (p as any).sku ?? sku;
  }
  const pr = resolvePrices(base, formula, vOv, pOv);
  return { ok: true, productId: productId!, variantId, retail: pr.retailPrice, wholesale: pr.wholesaleRate, mrp: pr.mrp ?? null, sku: resolvedSku };
}

async function recomputeSavedBillTotal(
  sb: ReturnType<typeof supabaseServer>,
  orderId: string,
  meta: { channel: string | null; billType: string; packing: number; courier: number; adjustment: number },
): Promise<number> {
  const { data: lines } = await sb.from("order_items").select("line_total").eq("order_id", orderId);
  const items = ((lines as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  const total = orderStoredTotalPaise({
    itemsPaise: items, packingPaise: meta.packing, courierPaise: meta.courier, adjustmentPaise: meta.adjustment,
    channel: meta.channel, billType: meta.billType,
  });
  await sb.from("orders").update({ total }).eq("id", orderId);
  return total;
}

/**
 * ONE-SHOT bill save — same idea as saveEstimateAction. The owner edits the bill the way they
 * create one (lines, packing, courier, GST, customer) and presses Save once.
 *
 * Held COD / pending backorders never moved stock, so lines are rewritten directly.
 * A posted sale still uses add/edit_order_line so inventory stays correct. Staff need the owner
 * OTP for a posted sale; the owner (and any held COD) do not — that OTP-per-line flow is what
 * made editing feel complicated.
 */
export async function saveOrderBillAction(input: {
  orderId: string;
  otp?: string;
  lines: { id: string; qty: number; priceRupees: number }[];
  removeIds: string[];
  newItems: { sku: string; qty: number; priceRupees?: number }[];
  charges: { packing: number; courier: number; adjustment: number };
  tax: BillTax;
  customer: { name?: string; phone?: string; gstin?: string; address?: string };
}): Promise<{ ok: boolean; error?: string; total?: number }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const orderId = (input.orderId ?? "").trim();
  if (!orderId) return { ok: false, error: "Missing bill." };
  const sb = supabaseServer();
  const { data: ord, error: oErr } = await sb.from("orders")
    .select("id,status,is_backorder,cod_hold,channel,bill_type,gst_mode,invoice_no")
    .eq("id", orderId).maybeSingle();
  if (oErr || !ord) return { ok: false, error: oErr?.message ?? "Bill not found." };
  const o = ord as any;
  if (String(o.status ?? "").toLowerCase() === "cancelled" || String(o.status ?? "").toLowerCase() === "refunded") {
    return { ok: false, error: "This bill is cancelled — nothing to edit." };
  }
  const held = !!o.cod_hold || !!o.is_backorder;
  const session = getSession();
  if (!held && !session.isOwner) {
    const otp = (input.otp ?? "").trim();
    if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  }

  const toP = (n: number) => Math.round((Number(n) || 0) * 100);
  const packing = Math.max(0, toP(input.charges?.packing ?? 0));
  const courier = Math.max(0, toP(input.charges?.courier ?? 0));
  const adjustment = toP(input.charges?.adjustment ?? 0);
  const tax: BillTax = input.tax === "none" || input.tax === "exclusive" || input.tax === "inclusive" ? input.tax : "inclusive";
  const billType = billTypeFromTax(tax);
  const gstMode = gstModeFromTax(tax);
  const channel = (o.channel ?? null) as string | null;
  const wholesale = String(channel ?? "").toLowerCase() === "wholesale";

  const keep = (input.lines ?? []).filter((l) => l?.id);
  const removeIds = (input.removeIds ?? []).filter(Boolean);
  if (keep.length + (input.newItems ?? []).filter((n) => n?.sku?.trim()).length === 0) {
    return { ok: false, error: "A bill needs at least one item." };
  }

  if (held) {
    if (removeIds.length) await sb.from("order_items").delete().eq("order_id", orderId).in("id", removeIds);
    for (const l of keep) {
      const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
      const unit = Math.max(0, toP(l.priceRupees));
      await sb.from("order_items").update({ qty, unit_price: unit, line_total: unit * qty }).eq("id", l.id).eq("order_id", orderId);
    }
    for (const ni of input.newItems ?? []) {
      const sku = (ni?.sku ?? "").trim();
      if (!sku) continue;
      const qty = Math.max(1, Math.floor(Number(ni.qty) || 1));
      const resolved = await resolveSkuForBill(sb, sku);
      if (!resolved.ok) return resolved;
      const typed = Number(ni.priceRupees);
      const unitPrice = Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100)
        : (wholesale ? resolved.wholesale : resolved.retail);
      let findQ = sb.from("order_items").select("id,qty,unit_price").eq("order_id", orderId).eq("product_id", resolved.productId).limit(1);
      findQ = resolved.variantId ? findQ.eq("variant_id", resolved.variantId) : findQ.is("variant_id", null);
      const { data: existRows } = await findQ;
      const exist = (existRows as any[])?.[0];
      if (exist) {
        const mergedQty = (exist.qty ?? 0) + qty;
        const keepUnit = Number.isFinite(typed) && typed >= 0 ? unitPrice : (exist.unit_price ?? unitPrice);
        await sb.from("order_items").update({ qty: mergedQty, unit_price: keepUnit, line_total: keepUnit * mergedQty }).eq("id", exist.id);
      } else {
        await sb.from("order_items").insert({
          order_id: orderId, product_id: resolved.productId, variant_id: resolved.variantId,
          qty, unit_price: unitPrice, line_total: unitPrice * qty, unit_mrp: resolved.mrp,
        });
      }
    }
  } else {
    // Posted sale: write the new rate first so qty RPCs use it, then qty/remove, then add lines.
    for (const l of keep) {
      const unit = Math.max(0, toP(l.priceRupees));
      const { data: cur } = await sb.from("order_items").select("qty,unit_price").eq("id", l.id).eq("order_id", orderId).maybeSingle();
      if (!cur) continue;
      if ((cur as any).unit_price !== unit) {
        const qty = (cur as any).qty ?? 1;
        await sb.from("order_items").update({ unit_price: unit, line_total: unit * qty }).eq("id", l.id);
      }
    }
    for (const id of removeIds) {
      const { error } = await sb.rpc("edit_order_line", { p_order_id: orderId, p_item_id: id, p_new_qty: 0 });
      if (error) return { ok: false, error: error.message };
    }
    for (const l of keep) {
      if (removeIds.includes(l.id)) continue;
      const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
      const { data: cur } = await sb.from("order_items").select("qty").eq("id", l.id).eq("order_id", orderId).maybeSingle();
      if (!cur) continue;
      if ((cur as any).qty !== qty) {
        const { error } = await sb.rpc("edit_order_line", { p_order_id: orderId, p_item_id: l.id, p_new_qty: qty });
        if (error) return { ok: false, error: error.message };
      }
    }
    for (const ni of input.newItems ?? []) {
      const sku = (ni?.sku ?? "").trim();
      if (!sku) continue;
      const qty = Math.max(1, Math.floor(Number(ni.qty) || 1));
      const resolved = await resolveSkuForBill(sb, sku);
      if (!resolved.ok) return resolved;
      const typed = Number(ni.priceRupees);
      const unitPrice = Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100)
        : (wholesale ? resolved.wholesale : resolved.retail);
      const { error } = await sb.rpc("add_order_line", {
        p_order_id: orderId, p_product_id: resolved.productId, p_variant_id: resolved.variantId,
        p_qty: qty, p_unit_price: unitPrice, p_unit_mrp: resolved.mrp, p_allow_oversell: false,
      });
      if (error) return { ok: false, error: error.message };
    }
  }

  const c = input.customer ?? {};
  const buyerGstin = (c.gstin ?? "").trim().toUpperCase() || null;
  const buyerState = buyerGstin && /^\d{2}/.test(buyerGstin) ? buyerGstin.slice(0, 2) : null;
  const patch: any = {
    customer_name: (c.name ?? "").trim() || null,
    customer_phone: (c.phone ?? "").trim() || null,
    buyer_gstin: buyerGstin,
    buyer_address: (c.address ?? "").trim() || null,
    buyer_state: buyerState,
    extra_packing: packing,
    extra_courier: courier,
    extra_adjustment: adjustment,
    bill_type: billType,
    gst_mode: gstMode,
  };
  const uRes = await (sb.from("orders") as any).update(patch).eq("id", orderId);
  if (uRes.error) {
    await sb.from("orders").update({
      customer_name: patch.customer_name, customer_phone: patch.customer_phone,
      extra_packing: packing, extra_courier: courier, extra_adjustment: adjustment,
    }).eq("id", orderId);
  }

  if (billType === "gst" && !o.invoice_no) {
    await sb.rpc("assign_invoice_no", { p_order: orderId }).then(() => {}, () => {});
  }

  const total = await recomputeSavedBillTotal(sb, orderId, { channel, billType, packing, courier, adjustment });
  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales"); revalidatePath("/admin/cod"); revalidatePath("/admin/backorders");
  revalidatePath("/admin/dashboard");
  return { ok: true, total };
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
