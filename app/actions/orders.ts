"use server";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { sendPurchase } from "@/lib/ga4";

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
  });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id, total = (data as any)?.total;
  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })) });
  return { ok: true, orderId, total };
}

export async function posSaleAction(input: {
  items: { sku: string; qty: number }[];
  customer: { name?: string; phone?: string };
  payment: string;
  billType?: "gst" | "cash";
  buyerGstin?: string;
  buyerAddress?: string;
  amountPaidRupees?: number; // partial/advance; defaults to full
}): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't ring up POS sales." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  for (const it of input.items) if (!Number.isFinite(it.qty) || it.qty < 1) return { ok: false, error: "Every line needs a quantity of 1 or more" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("place_order", {
    p_items: input.items, p_customer: input.customer ?? {}, p_channel: "pos", p_payment: input.payment || "cash",
  });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id, total = (data as any)?.total;

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

  // Amount received now (defaults to full payment at the counter).
  const amountPaid = input.amountPaidRupees != null
    ? Math.min(total as number, Math.max(0, Math.round(input.amountPaidRupees * 100)))
    : (total as number);

  await sb.from("orders").update({
    bill_type: billType,
    buyer_gstin: input.buyerGstin?.trim() || null,
    buyer_address: input.buyerAddress?.trim() || null,
    buyer_state: buyerState,
    customer_id: customerId,
    amount_paid: amountPaid,
  }).eq("id", orderId);
  await sb.rpc("assign_invoice_no", { p_order: orderId });

  await sendPurchase({ orderId, valuePaise: total, channel: "retail", items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })) });
  return { ok: true, orderId, total };
}
