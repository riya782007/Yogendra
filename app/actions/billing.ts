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
  const items = ((data as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  // Fold in the estimate's extra charges (Packing/Courier/Adjustment) so the quote total — and
  // the bill it converts to — matches the screen. Columns absent pre-migration ⇒ treated as 0.
  let charges = 0;
  const { data: est } = await sb.from("estimates").select("extra_packing,extra_courier,extra_adjustment").eq("id", estimateId).maybeSingle();
  if (est) charges = (((est as any).extra_packing) || 0) + (((est as any).extra_courier) || 0) + (((est as any).extra_adjustment) || 0);
  await sb.from("estimates").update({ total: items + charges }).eq("id", estimateId);
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
  // Resolve the SKU to a specific variant first (so the estimate records the exact colour),
  // then fall back to a bare product SKU.
  const { data: v } = await sb.from("variants").select("id,product_id,wholesale_override,retail_override,product:products(base_wholesale,wholesale_override,retail_override,mrp_override)").ilike("sku", sku).maybeSingle();
  let productId: string, variantId: string | null = null, base: number, ov: any;
  if (v) {
    const vp = (v as any).product;
    productId = (v as any).product_id; variantId = (v as any).id; base = vp.base_wholesale;
    ov = { wholesale_override: (v as any).wholesale_override ?? vp.wholesale_override, retail_override: (v as any).retail_override ?? vp.retail_override, mrp_override: vp.mrp_override };
  } else {
    const { data: p } = await sb.from("products").select("id,base_wholesale,wholesale_override,retail_override,mrp_override").ilike("sku", sku).maybeSingle();
    if (!p) return;
    productId = (p as any).id; base = (p as any).base_wholesale; ov = overridesOf(p);
  }
  const formula = await getPricingFormula();
  const unit = resolvePrices(base, formula, ov).retailPrice;
  await sb.from("estimate_items").insert({ estimate_id: estimateId, product_id: productId, variant_id: variantId, qty, unit_price: unit, line_total: unit * qty });
  await recomputeEstimateTotal(sb, estimateId);
  revalidatePath(`/admin/estimate/${estimateId}`);
}

export async function createEstimateAction(input: { items: { sku: string; qty: number; priceRupees?: number }[]; customer: { name?: string; phone?: string }; packingRupees?: number; courierRupees?: number; adjustmentRupees?: number }): Promise<{ ok: boolean; estimateId?: string; total?: number; error?: string }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't create estimates." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("create_estimate", { p_items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })), p_customer: input.customer ?? {} });
  if (error) return { ok: false, error: error.message };
  const estimateId = (data as any)?.estimate_id;
  let outTotal = (data as any)?.total as number | undefined;
  if (estimateId) {
    // Extra charges (best-effort; needs migration 0021). Adjustment may be ±.
    const xp = Math.max(0, Math.round((input.packingRupees ?? 0) * 100));
    const xc = Math.max(0, Math.round((input.courierRupees ?? 0) * 100));
    const xa = Math.round((input.adjustmentRupees ?? 0) * 100);
    const hasCharges = xp !== 0 || xc !== 0 || xa !== 0;
    if (hasCharges) {
      const { error: chErr } = await sb.from("estimates").update({ extra_packing: xp, extra_courier: xc, extra_adjustment: xa }).eq("id", estimateId);
      if (chErr) console.warn("estimate charges not saved — apply migration 0021_billing_charges.sql:", chErr.message);
    }
    // Apply the per-line rates the counter set (R/W tier or an edited rate) so the saved quote —
    // and the bill it converts to (convert uses estimate_items.unit_price) — matches the screen.
    // Match estimate_items back to the inputs by SKU.
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
    // The RPC stores only the name; persist the phone too.
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
  if (orderId) {
    // Carry the estimate's extra charges onto the new order so the bill itemises them and GST
    // applies — order.total is recomputed as items + charges to stay authoritative.
    const { data: est } = await sb.from("estimates").select("extra_packing,extra_courier,extra_adjustment").eq("id", id).maybeSingle();
    const xp = ((est as any)?.extra_packing) || 0, xc = ((est as any)?.extra_courier) || 0, xa = ((est as any)?.extra_adjustment) || 0;
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

/** Convert a backorder into a fulfilled sale once stock has arrived — clears the backorder flag so
 *  it drops off the Backorders list and counts as a normal completed sale. */
export async function fulfillBackorderAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await supabaseServer().from("orders").update({ is_backorder: false }).eq("id", id);
  revalidatePath("/admin/backorders"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
}

export async function recordReturnAction(input: { orderId: string; reason: string; items: { product_id: string; variantSku?: string; qty: number }[] }): Promise<{ ok: boolean; qty?: number; error?: string }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns/refunds." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Capture a return reason" };
  // The RPC restocks by product_id; variantSku is carried for display/audit (variant-exact restock TBD).
  const p_items = input.items.map((i) => ({ product_id: i.product_id, qty: i.qty }));
  const { data, error } = await supabaseServer().rpc("record_sales_return", { p_order_id: input.orderId, p_reason: input.reason, p_items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/returns"); revalidatePath("/admin/dashboard");
  return { ok: true, qty: (data as any)?.qty };
}
