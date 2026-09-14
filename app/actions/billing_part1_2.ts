"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";
import { recomputeEstimateTotal } from "./billing_part1_0";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";
/**
 * ONE-SHOT estimate save — the whole open estimate edited on a single screen and saved with one click
 * (owner: "poora bill ek saath edit ho, Vyapar jaisa"). Applies line qty/rate edits, removals, new
 * items, customer, GST and all charges together, then recomputes the total once.
 */
export async function saveEstimateAction(input: {
  id: string;
  lines: { id: string; qty: number; priceRupees: number }[];
  removeIds: string[];
  newItems: { sku: string; qty: number; priceRupees?: number }[];
  charges: { discount: number; packing: number; courier: number; tcs: number; adjustment: number };
  tax: "none" | "inclusive" | "exclusive";
  customer: { name?: string; phone?: string; gstin?: string; address?: string; email?: string; shipName?: string; shipAddr?: string };
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't edit estimates." };
  const id = (input.id ?? "").trim();
  if (!id) return { ok: false, error: "Missing estimate." };
  const sb = supabaseServer();

  const removeIds = (input.removeIds ?? []).filter(Boolean);
  if (removeIds.length) await sb.from("estimate_items").delete().eq("estimate_id", id).in("id", removeIds);

  for (const l of input.lines ?? []) {
    if (!l?.id) continue;
    const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
    const unit = Math.max(0, Math.round((Number(l.priceRupees) || 0) * 100));
    await sb.from("estimate_items").update({ qty, unit_price: unit, line_total: unit * qty }).eq("id", l.id).eq("estimate_id", id);
  }

  const formula = await getPricingFormula();
  for (const ni of input.newItems ?? []) {
    const sku = (ni?.sku ?? "").trim().toUpperCase();
    if (!sku) continue;
    const qty = Math.max(1, Math.floor(Number(ni.qty) || 1));
    const { data: v } = await sb.from("variants").select("id,product_id,wholesale_override,retail_override,product:products(base_wholesale,wholesale_override,retail_override,mrp_override)").ilike("sku", sku).maybeSingle();
    let productId: string, variantId: string | null = null, base: number, ov: any;
    if (v) {
      const vp = (v as any).product;
      productId = (v as any).product_id; variantId = (v as any).id; base = vp.base_wholesale;
      ov = { wholesale_override: (v as any).wholesale_override ?? vp.wholesale_override, retail_override: (v as any).retail_override ?? vp.retail_override, mrp_override: vp.mrp_override };
    } else {
      const { data: p } = await sb.from("products").select("id,base_wholesale,wholesale_override,retail_override,mrp_override").ilike("sku", sku).maybeSingle();
      if (!p) continue;
      productId = (p as any).id; base = (p as any).base_wholesale; ov = overridesOf(p);
    }
    const unit = (ni.priceRupees != null && Number.isFinite(ni.priceRupees) && ni.priceRupees >= 0)
      ? Math.round(ni.priceRupees * 100)
      : resolvePrices(base, formula, ov).retailPrice;
    let findQ = sb.from("estimate_items").select("id,qty,unit_price").eq("estimate_id", id).eq("product_id", productId).limit(1);
    findQ = variantId ? findQ.eq("variant_id", variantId) : findQ.is("variant_id", null);
    const { data: existRows } = await findQ;
    const exist = (existRows as any[])?.[0];
    if (exist) {
      const mergedQty = (exist.qty ?? 0) + qty;
      const keepUnit = (exist.unit_price ?? unit);
      await sb.from("estimate_items").update({ qty: mergedQty, unit_price: keepUnit, line_total: keepUnit * mergedQty }).eq("id", exist.id);
    } else {
      await sb.from("estimate_items").insert({ estimate_id: id, product_id: productId, variant_id: variantId, qty, unit_price: unit, line_total: unit * qty });
    }
  }

  const c = input.customer ?? {};
  const custPatch: any = {
    customer_name: (c.name ?? "").trim() || null, customer_phone: (c.phone ?? "").trim() || null,
    buyer_gstin: (c.gstin ?? "").trim().toUpperCase() || null, buyer_address: (c.address ?? "").trim() || null,
    buyer_email: (c.email ?? "").trim() || null, ship_to_name: (c.shipName ?? "").trim() || null, ship_to_address: (c.shipAddr ?? "").trim() || null,
  };
  const cRes = await (sb.from("estimates") as any).update(custPatch).eq("id", id);
  if (cRes.error) await sb.from("estimates").update({ customer_name: custPatch.customer_name, customer_phone: custPatch.customer_phone }).eq("id", id);

  const gstPatch: any = input.tax === "none" ? { gst: false } : { gst: true, gst_mode: input.tax === "inclusive" ? "inclusive" : "exclusive" };
  const gRes = await (sb.from("estimates") as any).update(gstPatch).eq("id", id);
  if (gRes.error) await sb.from("estimates").update({ gst: input.tax !== "none" }).eq("id", id);

  const toP = (n: number) => Math.round((Number(n) || 0) * 100);
  const chg = input.charges ?? { discount: 0, packing: 0, courier: 0, tcs: 0, adjustment: 0 };
  await (sb.from("estimates") as any).update({
    extra_discount: Math.max(0, toP(chg.discount)), extra_packing: Math.max(0, toP(chg.packing)),
    extra_courier: Math.max(0, toP(chg.courier)), extra_tcs: Math.max(0, toP(chg.tcs)), extra_adjustment: toP(chg.adjustment),
  }).eq("id", id).then(() => {}, () => {});

  await recomputeEstimateTotal(sb, id);
  await sb.rpc("resync_estimate_hold", { p_estimate_id: id });
  revalidatePath(`/admin/estimate/${id}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
  return { ok: true };
}
