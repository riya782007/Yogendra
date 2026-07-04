"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { sendPurchase } from "@/lib/ga4";
import { notifyOrderPlaced } from "@/lib/whatsapp";

export type PlaceOrderInput = {
  items: { sku: string; qty: number; color?: string }[];
  customer: { name: string; phone: string; address: string; pincode: string; city?: string };
  payment: "cod" | "online";
};

export async function placeOrderAction(input: PlaceOrderInput): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  if (!input.items?.length) return { ok: false, error: "Cart is empty" };
  if (!input.customer?.name || !input.customer?.phone || !input.customer?.address) return { ok: false, error: "Please fill name, phone and address" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("place_order", {
    p_items: input.items,
    p_customer: input.customer,
    p_channel: "retail",
    p_payment: input.payment,
    p_allow_oversell: false, // online retail never oversells
    p_tier: "retail",
  });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id, total = (data as any)?.total;
  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })) });
  await notifyOrderPlaced({
    orderId, customerName: input.customer.name, customerPhone: input.customer.phone,
    totalPaise: total, payment: input.payment, itemCount: input.items.reduce((n, i) => n + i.qty, 0),
  }).catch(() => {});
  return { ok: true, orderId, total };
}

export async function posSaleAction(input: {
  items: { sku: string; qty: number; priceRupees?: number; listRupees?: number }[];
  customer: { name?: string; phone?: string };
  payment: string;
  billType?: "gst" | "cash";
  buyerGstin?: string;
  buyerAddress?: string;
  amountPaidRupees?: number; // partial/advance; defaults to full
  allowOversell?: boolean; // owner opt-in to bill beyond stock (backorder)
  backorder?: boolean; // this sale was billed beyond available stock (surfaces in /admin/backorders)
  tier?: "retail" | "wholesale"; // price list to bill at (#16)
  salesEmployeeId?: string; // who dealt with the customer (employee performance attribution)
  payCashRupees?: number; // split tender — cash portion (#14/#37) [legacy]
  payBankRupees?: number; // split tender — UPI/card/bank portion (#14/#37) [legacy]
  packingRupees?: number; // extra charge — packing (GST-applicable)
  courierRupees?: number; // extra charge — courier / shipping (GST-applicable)
  adjustmentRupees?: number; // ± adjustment / round-off (GST-applicable)
  paymentMethod?: string; // which bank/UPI account received the non-cash portion (#10) [legacy]
  // Centralized Payment Methods (Phase 1): one row per tender, referencing payment_methods.id.
  // When supplied this is the source of truth — it drives the per-method ledger AND back-fills
  // the legacy pay_cash / pay_bank / payment_method fields so existing reports keep working.
  payments?: { methodId: string; amount: number }[]; // amount in rupees
}): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't ring up POS sales." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  for (const it of input.items) if (!Number.isFinite(it.qty) || it.qty < 1) return { ok: false, error: "Every line needs a quantity of 1 or more" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("place_order", {
    p_items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })), p_customer: input.customer ?? {}, p_channel: "pos", p_payment: input.payment || "cash",
    p_allow_oversell: !!input.allowOversell, p_tier: input.tier === "wholesale" ? "wholesale" : "retail",
  });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id;
  let total = (data as any)?.total as number;

  // Pillar 15 — per-line price edits (manual discount / custom rate at the counter).
  // The RPC priced every line at the catalogue/tier rate; here we overwrite the unit price
  // on the specific lines the owner edited, then ALWAYS recompute the order total from the
  // actual order_items so the bill, GST split and ledger stay internally consistent even
  // if a match is skipped. Best-effort and fully guarded — a failed match falls back to the
  // catalogue price rather than corrupting the bill.
  const overrides = (input.items ?? []).filter((i) => i.priceRupees != null && Number.isFinite(i.priceRupees) && (i.priceRupees as number) >= 0);
  if (orderId && overrides.length) {
    try {
      for (const o of overrides) {
        const unit = Math.round((o.priceRupees as number) * 100);
        // Resolve the scanned SKU to its product (and variant, if it's a variant SKU).
        let productId: string | null = null;
        let variantId: string | null = null;
        const { data: prod } = await sb.from("products").select("id").ilike("sku", o.sku).maybeSingle();
        if (prod) productId = (prod as any).id;
        else {
          const { data: v } = await sb.from("variants").select("id,product_id").ilike("sku", o.sku).maybeSingle();
          if (v) { variantId = (v as any).id; productId = (v as any).product_id; }
        }
        if (!productId) continue; // can't map — leave the catalogue price on that line
        // Original (pre-discount) rate for the invoice's Rate → Disc → Amount display. Only stored
        // when it's actually higher than the billed net, so a plain override doesn't fake a discount.
        const list = Number.isFinite(o.listRupees as number) ? Math.round((o.listRupees as number) * 100) : 0;
        const patch: Record<string, number> = { unit_price: unit, line_total: unit * o.qty };
        if (list > unit) patch.unit_mrp = list;
        let upd = sb.from("order_items").update(patch).eq("order_id", orderId).eq("product_id", productId);
        upd = variantId ? upd.eq("variant_id", variantId) : upd.is("variant_id", null);
        await upd;
      }
      // Recompute the authoritative total from the (possibly edited) line items.
      const { data: lines } = await sb.from("order_items").select("line_total").eq("order_id", orderId);
      const recomputed = ((lines as any[]) ?? []).reduce((s, l) => s + (l.line_total ?? 0), 0);
      if (recomputed > 0) total = recomputed;
    } catch {
      /* keep the RPC's total if reconciliation hits a snag — never corrupt the bill */
    }
  }

  // Extra charges (Packing / Courier / Adjustment) — GST-applicable, so they fold into the
  // order total (GST is computed on it) and are itemised on the bill. Adjustment may be ±.
  const xPacking = Math.max(0, Math.round((input.packingRupees ?? 0) * 100));
  const xCourier = Math.max(0, Math.round((input.courierRupees ?? 0) * 100));
  const xAdjust = Math.round((input.adjustmentRupees ?? 0) * 100);
  const xCharges = xPacking + xCourier + xAdjust;
  total = total + xCharges;

  // Persist B2B bill metadata on the order so the invoice/cash-memo renders correctly.
  const billType = input.billType === "cash" ? "cash" : "gst";
  const buyerState = input.buyerGstin && /^\d{2}/.test(input.buyerGstin.trim()) ? input.buyerGstin.trim().slice(0, 2) : null;
  // A GST tax invoice is exclusive → the customer pays total + GST. Cap/allow the recorded payment
  // up to this GRAND total (not the pre-tax total), so a fully-paid GST bill records the tax-
  // inclusive amount and the printed invoice shows no phantom balance for the tax.
  // Round to the nearest ₹1 to MATCH the invoice's Grand Total (which shows a round-off line and is
  // what the customer actually hands over) — otherwise a full cash payment leaves a paise-level
  // phantom balance. This is the exact number the invoice prints as "Grand Total".
  const GST_RATE = 3;
  const grandRawPaise = billType === "gst" ? (total as number) + Math.round(((total as number) * GST_RATE) / 100) : (total as number);
  const grandTotalPaise = Math.round(grandRawPaise / 100) * 100;

  // Upsert into the customer directory (by phone) and link the order to it.
  let customerId: string | null = null;
  const ph = input.customer?.phone?.trim();
  const nm = input.customer?.name?.trim();
  if (ph || nm) {
    const { data: existing } = ph ? await sb.from("customers").select("id").eq("phone", ph).maybeSingle() : { data: null };
    if (existing) {
      customerId = (existing as any).id;
      if (input.buyerGstin?.trim()) await sb.from("customers").update({ gstin: input.buyerGstin.trim() }).eq("id", customerId);
    } else if (nm || ph) {
      const { data: created } = await sb.from("customers")
        .insert({ name: nm || ph || "Walk-in", phone: ph || null, gstin: input.buyerGstin?.trim() || null, address: input.buyerAddress?.trim() || null, type: "retail" })
        .select("id").maybeSingle();
      customerId = (created as any)?.id ?? null;
    }
  }

  // ---- Tender resolution -----------------------------------------------------------------
  // Centralized Payment Methods (Phase 1) take priority: each line references payment_methods.id.
  // We resolve their kind to split into the legacy cash vs bank buckets (so old reports keep
  // working) AND, after the order is saved, write one ledger row per tender into
  // payment_method_transactions (so per-method balances update). Falls back to the legacy
  // cash/bank split, then to a single-mode receipt, when no payments[] is supplied.
  const payLinesIn = (input.payments ?? []).filter((p) => p.methodId && Number(p.amount) > 0);
  let pmResolved: { id: string; name: string; kind: string; paise: number }[] = [];
  if (payLinesIn.length) {
    const ids = [...new Set(payLinesIn.map((p) => p.methodId))];
    const { data: pms } = await sb.from("payment_methods").select("id,name,kind").in("id", ids);
    const byId = new Map<string, any>(((pms as any[]) ?? []).map((m) => [m.id, m]));
    pmResolved = payLinesIn
      .map((p) => {
        const m = byId.get(p.methodId);
        return { id: p.methodId, name: m?.name ?? "", kind: String(m?.kind ?? "bank").toLowerCase(), paise: Math.max(0, Math.round(Number(p.amount) * 100)) };
      })
      .filter((p) => p.name && p.paise > 0);
  }
  const methodsGiven = pmResolved.length > 0;

  const splitGiven = !methodsGiven && (input.payCashRupees != null || input.payBankRupees != null);
  let payCash = methodsGiven
    ? pmResolved.filter((p) => p.kind === "cash").reduce((s, p) => s + p.paise, 0)
    : Math.max(0, Math.round((input.payCashRupees ?? 0) * 100));
  let payBank = methodsGiven
    ? pmResolved.filter((p) => p.kind !== "cash").reduce((s, p) => s + p.paise, 0)
    : Math.max(0, Math.round((input.payBankRupees ?? 0) * 100));
  const amountPaid = (methodsGiven || splitGiven)
    ? Math.min(grandTotalPaise, payCash + payBank)
    : (input.amountPaidRupees != null
        ? Math.min(grandTotalPaise, Math.max(0, Math.round(input.amountPaidRupees * 100)))
        : grandTotalPaise);
  // For a single-mode sale, attribute the whole receipt to the right bucket.
  if (!methodsGiven && !splitGiven) {
    if ((input.payment || "cash") === "cash") payCash = amountPaid; else payBank = amountPaid;
  }
  const payMode = (methodsGiven || splitGiven)
    ? (payCash > 0 && payBank > 0 ? "split" : payBank > 0 ? "upi" : "cash")
    : (input.payment || "cash");
  // Legacy single-method label = first non-cash method (else first method) for the Bank & Cash breakdown.
  const legacyMethodName = methodsGiven
    ? (pmResolved.find((p) => p.kind !== "cash")?.name ?? pmResolved[0]?.name ?? null)
    : (input.paymentMethod ?? null);

  await sb.from("orders").update({
    bill_type: billType,
    buyer_gstin: input.buyerGstin?.trim() || null,
    buyer_address: input.buyerAddress?.trim() || null,
    buyer_state: buyerState,
    customer_id: customerId,
    sales_employee_id: input.salesEmployeeId?.trim() || null,
    total,
    amount_paid: amountPaid,
    payment_mode: payMode,
    pay_cash: payCash,
    pay_bank: payBank,
  }).eq("id", orderId);

  // Itemised charge breakdown — best-effort; needs migration 0021. Never breaks a sale.
  if (xCharges !== 0) {
    const { error: chErr } = await sb.from("orders").update({ extra_packing: xPacking, extra_courier: xCourier, extra_adjustment: xAdjust }).eq("id", orderId);
    if (chErr) console.warn("charge breakdown not saved — apply migration 0021_billing_charges.sql:", chErr.message);
  }

  // Record which bank/UPI account received the money — best-effort; needs migration 0025.
  if (legacyMethodName) {
    const { error: pmErr } = await sb.from("orders").update({ payment_method: legacyMethodName }).eq("id", orderId);
    if (pmErr) console.warn("payment_method not saved — apply migration 0025_payment_methods.sql:", pmErr.message);
  }

  // NEW (Phase 1): per-method ledger so Bank & Payment Methods balances update automatically.
  // Best-effort — needs migration 0027. A failure here never breaks the sale.
  if (methodsGiven) {
    try {
      const rows = pmResolved.map((p) => ({
        method_id: p.id, txn_type: "sale", direction: "in", amount: p.paise,
        ref_type: "order", ref_id: orderId, note: "POS sale", created_by: "owner",
      }));
      const { error: ledErr } = await sb.from("payment_method_transactions").insert(rows);
      if (ledErr) console.warn("payment ledger not written — apply migration 0027_payment_methods_v2.sql:", ledErr.message);
    } catch (e) {
      console.warn("payment ledger insert failed:", (e as any)?.message);
    }
  }

  await sb.rpc("assign_invoice_no", { p_order: orderId });

  // Backorder flag — best-effort so it can never break a sale. When the owner billed
  // beyond available stock (ticked "bill anyway as a backorder"), mark the order so it
  // shows on /admin/backorders. No-ops gracefully until migration 0020 adds the column.
  if (input.backorder) {
    const { error: boErr } = await sb.from("orders").update({ is_backorder: true }).eq("id", orderId);
    if (boErr) console.warn("backorder flag not set — apply migration 0020_order_backorder.sql:", boErr.message);
  }

  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })) });
  return { ok: true, orderId, total };
}
