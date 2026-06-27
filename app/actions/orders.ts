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
  items: { sku: string; qty: number; priceRupees?: number }[];
  customer: { name?: string; phone?: string };
  payment: string;
  billType?: "gst" | "cash";
  buyerGstin?: string;
  buyerAddress?: string;
  amountPaidRupees?: number; // partial/advance; defaults to full
  allowOversell?: boolean; // owner opt-in to bill beyond stock (backorder)
  tier?: "retail" | "wholesale"; // price list to bill at (#16)
  payCashRupees?: number; // split tender — cash portion (#14/#37)
  payBankRupees?: number; // split tender — UPI/card/bank portion (#14/#37)
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
        let upd = sb.from("order_items").update({ unit_price: unit, line_total: unit * o.qty }).eq("order_id", orderId).eq("product_id", productId);
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

  // Persist B2B bill metadata on the order so the invoice/cash-memo renders correctly.
  const billType = input.billType === "cash" ? "cash" : "gst";
  const buyerState = input.buyerGstin && /^\d{2}/.test(input.buyerGstin.trim()) ? input.buyerGstin.trim().slice(0, 2) : null;

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

  // Split tender (#14/#37): cash vs bank (UPI/card). If a split is supplied it drives
  // the amount paid; otherwise fall back to a single "amount received" at one mode.
  const splitGiven = input.payCashRupees != null || input.payBankRupees != null;
  let payCash = Math.max(0, Math.round((input.payCashRupees ?? 0) * 100));
  let payBank = Math.max(0, Math.round((input.payBankRupees ?? 0) * 100));
  const amountPaid = splitGiven
    ? Math.min(total as number, payCash + payBank)
    : (input.amountPaidRupees != null
        ? Math.min(total as number, Math.max(0, Math.round(input.amountPaidRupees * 100)))
        : (total as number));
  // For a single-mode sale, attribute the whole receipt to the right bucket.
  if (!splitGiven) {
    if ((input.payment || "cash") === "cash") payCash = amountPaid; else payBank = amountPaid;
  }
  const payMode = splitGiven
    ? (payCash > 0 && payBank > 0 ? "split" : payBank > 0 ? "upi" : "cash")
    : (input.payment || "cash");

  await sb.from("orders").update({
    bill_type: billType,
    buyer_gstin: input.buyerGstin?.trim() || null,
    buyer_address: input.buyerAddress?.trim() || null,
    buyer_state: buyerState,
    customer_id: customerId,
    total,
    amount_paid: amountPaid,
    payment_mode: payMode,
    pay_cash: payCash,
    pay_bank: payBank,
  }).eq("id", orderId);
  await sb.rpc("assign_invoice_no", { p_order: orderId });

  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })) });
  return { ok: true, orderId, total };
}
