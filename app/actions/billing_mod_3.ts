"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";
import { recomputeEstimateTotal } from "./billing_mod_0";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export async function createEstimateAction(input: { items: { sku: string; qty: number; priceRupees?: number }[]; customer: { name?: string; phone?: string }; packingRupees?: number; courierRupees?: number; adjustmentRupees?: number; gst?: "none" | "inclusive" | "exclusive" }): Promise<{ ok: boolean; estimateId?: string; total?: number; error?: string }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't create estimates." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("create_estimate", { p_items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })), p_customer: input.customer ?? {} });
  if (error) return { ok: false, error: error.message };
  const estimateId = (data as any)?.estimate_id;
  let outTotal = (data as any)?.total as number | undefined;
  if (estimateId) {
    const xp = Math.max(0, Math.round((input.packingRupees ?? 0) * 100));
    const xc = Math.max(0, Math.round((input.courierRupees ?? 0) * 100));
    const xa = Math.round((input.adjustmentRupees ?? 0) * 100);
    const hasCharges = xp !== 0 || xc !== 0 || xa !== 0;
    if (hasCharges) {
      const { error: chErr } = await sb.from("estimates").update({ extra_packing: xp, extra_courier: xc, extra_adjustment: xa }).eq("id", estimateId);
      if (chErr) console.warn("estimate charges not saved:", chErr.message);
    }
    const priced = input.items.filter((i) => i.priceRupees != null && Number.isFinite(i.priceRupees) && (i.priceRupees as number) >= 0);
    if (priced.length) {
      const { data: its } = await sb.from("estimate_items").select("id, qty, product:products(sku), variant:variants(sku)").eq("estimate_id", estimateId);
      const bySku = new Map<string, { id: string; qty: number }>();
      for (const it of ((its as any[]) ?? [])) { const sku = (it as any).variant?.sku ?? (it as any).product?.sku; if (sku) bySku.set(String(sku).toUpperCase(), { id: it.id, qty: it.qty }); }
      for (const i of priced) {
        const m = bySku.get(i.sku.toUpperCase());
        if (!m) continue;
        const unit = Math.round((i.priceRupees as number) * 100);
        await sb.from("estimate_items").update({ unit_price: unit, line_total: unit * m.qty }).eq("id", m.id);
      }
    }
    if (priced.length || hasCharges) await recomputeEstimateTotal(sb, estimateId);
    if (input.gst === "inclusive" || input.gst === "exclusive") {
      await sb.from("estimates").update({ gst: true, gst_mode: input.gst }).eq("id", estimateId);
    } else {
      await sb.from("estimates").update({ gst: false, gst_mode: "none" }).eq("id", estimateId);
    }
    if (input.customer?.phone) await sb.from("estimates").update({ customer_phone: input.customer.phone }).eq("id", estimateId);
    const { data: est } = await sb.from("estimates").select("total").eq("id", estimateId).maybeSingle();
    if (est) outTotal = (est as any).total;
  }
  revalidatePath("/admin/estimates");
  return { ok: true, estimateId, total: outTotal };
}

export async function convertEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().rpc("convert_estimate", { p_estimate_id: id });
  revalidatePath("/admin/estimates"); revalidatePath("/admin/dashboard");
}

export async function billEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) redirect("/admin/estimates");
  const id = String(formData.get("id"));
  const billType = String(formData.get("bill_type") ?? "gst") === "cash" ? "cash" : "gst";
  const allowOversell = String(formData.get("allow_oversell") ?? "") === "1";
  const sb = supabaseServer();
  const { data: estRow } = await sb.from("estimates").select("status").eq("id", id).maybeSingle();
  if ((estRow as any)?.status === "held") await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  const { data, error } = await sb.rpc("convert_estimate_v2", { p_estimate_id: id, p_bill_type: billType, p_allow_oversell: allowOversell });
  if (error) redirect(`/admin/estimate/${id}?billerror=${encodeURIComponent(error.message)}`);
  const orderId = (data as any)?.order_id;
  if (orderId) {
    const { data: est } = await sb.from("estimates").select("*").eq("id", id).maybeSingle();
    const carry: any = {};
    const em = (est as any)?.gst_mode;
    if (billType === "gst" && (em === "inclusive" || em === "exclusive")) carry.gst_mode = em;
    if ((est as any)?.buyer_gstin) carry.buyer_gstin = (est as any).buyer_gstin;
    if ((est as any)?.buyer_address) carry.buyer_address = (est as any).buyer_address;
    if (Object.keys(carry).length) {
      const r = await (sb.from("orders") as any).update(carry).eq("id", orderId);
      if (r.error) console.warn("estimate→bill: could not carry tax details:", r.error.message);
    }
    const xp = ((est as any)?.extra_packing) || 0, xc = ((est as any)?.extra_courier) || 0;
    const xa = (((est as any)?.extra_adjustment) || 0) + (((est as any)?.extra_tcs) || 0) - (((est as any)?.extra_discount) || 0);
    if (xp !== 0 || xc !== 0 || xa !== 0) {
      const { data: oi } = await sb.from("order_items").select("line_total").eq("order_id", orderId);
      const itemsSum = ((oi as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
      await sb.from("orders").update({ extra_packing: xp, extra_courier: xc, extra_adjustment: xa, total: itemsSum + xp + xc + xa }).eq("id", orderId);
    }
    await sb.rpc("assign_invoice_no", { p_order: orderId });
  }
  revalidatePath("/admin/estimates"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/sales");
  if (orderId) redirect(`/admin/invoice/${orderId}`);
  redirect("/admin/estimates");
}

export async function denyEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.deny"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  await sb.from("estimates").update({ status: "denied" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}
