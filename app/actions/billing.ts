"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

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
  // fulfill_backorder is ALL-OR-NOTHING: it re-checks stock on every line (blocks with a clear
  // error if still short), THEN moves stock + logs the sale movements + posts revenue + releases
  // the bill into the sales record. The old flag-flip skipped all of that.
  const { error } = await supabaseServer().rpc("fulfill_backorder", { p_order_id: id });
  revalidatePath("/admin/backorders"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  if (error) redirect(`/admin/backorders?err=${encodeURIComponent(error.message)}`);
  redirect("/admin/backorders?ok=1");
}

/** Lines of ONE order, shaped for the inline return dialog on the Sales page — so a return can be
 *  recorded straight from the bill row without hunting for it in a separate module. */
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
  // Already-returned per (product, variant) on THIS bill — summed from its return movements, so the
  // dialog can cap each line at (sold − returned) and CLOSE the window once fully returned.
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

export async function recordReturnAction(input: { orderId: string; reason: string; items: { product_id: string; variantSku?: string; qty: number }[] }): Promise<{ ok: boolean; qty?: number; error?: string; pending?: boolean }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns/refunds." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Capture a return reason" };
  const sb = supabaseServer();

  // A sales return restocks goods and reverses money — so STAFF cannot finalise one on their own.
  // Only the owner may. A staff request is raised as an approval the owner clears with the OTP on
  // /admin/approvals; on approval the return is executed there (see decideApprovalAction).
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

  // Variant-EXACT return: resolve each line's variantSku to its variants.id so the RPC restocks
  // the precise colour (the old code dropped variantSku — colour rows never rose, product totals
  // desynced from Σ variants, and the client's tally broke).
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
  revalidatePath("/admin/creditors"); revalidatePath("/shop"); revalidatePath("/admin/customers");
  return { ok: true, qty: (data as any)?.qty };
}

/**
 * Cancel a whole order (e.g. a dealer or retail COD order the customer backed out of).
 * Restocks every line, reverses the sale in the ledger, and marks the order "cancelled".
 * Money-reversing, so it is OWNER-ONLY — staff can't self-cancel.
 */
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

/**
 * PAYMENT-IN from a customer (client point 16): the owner receives ₹X (cash/UPI/bank) against a
 * customer's outstanding and it auto-allocates OLDEST BILL FIRST — amount_paid rises per bill
 * (GST-inclusive receivable, net of return credits), pay_cash/pay_bank feed Bank & Cash, and the
 * customer's outstanding falls everywhere (customer page, creditors, sales status chips).
 */
export async function receiveCustomerPaymentAction(input: { customerId?: string | null; phone?: string | null; amountRupees: number; method: "cash" | "upi" | "bank"; note?: string }): Promise<{ ok: boolean; allocated?: { invoice: string; paise: number }[]; leftoverPaise?: number; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't receive payments." };
  const paise = Math.round((input.amountRupees ?? 0) * 100);
  if (!Number.isFinite(paise) || paise <= 0) return { ok: false, error: "Enter the amount received." };
  if (!input.customerId && !input.phone) return { ok: false, error: "Missing customer" };
  const sb = supabaseServer();

  const sel = "id,invoice_no,total,amount_paid,bill_type,gst_mode,status,pay_cash,pay_bank,created_at";
  const byId = input.customerId ? await sb.from("orders").select(sel).eq("customer_id", input.customerId).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const byPhone = input.phone ? await sb.from("orders").select(sel).eq("customer_phone", input.phone).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const seen = new Set<string>();
  const orders = [...(((byId.data as any[]) ?? [])), ...(((byPhone.data as any[]) ?? []))]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .filter((o) => o.status !== "cancelled")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const credits = await returnCreditsByOrder(orders.map((o) => o.id));
  let remaining = paise;
  const allocated: { invoice: string; paise: number }[] = [];
  for (const o of orders) {
    if (remaining <= 0) break;
    const due = orderReceivable(o, credits.get(o.id) ?? 0);
    if (due <= 0) continue;
    const alloc = Math.min(due, remaining);
    const patch: Record<string, number> = { amount_paid: (o.amount_paid ?? 0) + alloc };
    if (input.method === "cash") patch.pay_cash = (o.pay_cash ?? 0) + alloc;
    else patch.pay_bank = (o.pay_bank ?? 0) + alloc;
    const { error } = await sb.from("orders").update(patch).eq("id", o.id);
    if (error) return { ok: false, error: error.message };
    allocated.push({ invoice: o.invoice_no || String(o.id).slice(0, 8).toUpperCase(), paise: alloc });
    remaining -= alloc;
  }
  if (!allocated.length) return { ok: false, error: "No outstanding bills found for this customer." };

  await sb.from("audit_log").insert({
    actor: "owner", action: "payment_in",
    ref: input.customerId ?? input.phone ?? "",
    detail: `Received ₹${Math.round(paise / 100)} (${input.method})${input.note ? ` — ${input.note}` : ""} → ${allocated.map((a) => `${a.invoice} ₹${Math.round(a.paise / 100)}`).join(", ")}${remaining > 0 ? ` · ₹${Math.round(remaining / 100)} unallocated (advance)` : ""}`,
  }).then(() => {}, () => {});

  revalidatePath("/admin/creditors"); revalidatePath("/admin/sales"); revalidatePath("/admin/customers");
  if (input.customerId) revalidatePath(`/admin/customer/${input.customerId}`);
  return { ok: true, allocated, leftoverPaise: remaining };
}
