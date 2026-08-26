"use server";

import { createClient } from "@supabase/supabase-js";

export interface BillItemUpdate {
  sku: string;
  rate: number;
  quantity: number;
  discount?: number;
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  return createClient(url, key);
}

export async function updateBillItemsAction(
  orderId: string,
  updatedItems: BillItemUpdate[],
  paymentMode: string = "CASH"
) {
  const supabase = getSupabaseClient();

  // 1. Recalculate Subtotal and Grand Total from updated line item rates
  let newSubtotal = 0;
  for (const item of updatedItems) {
    const itemTotal = (item.rate * item.quantity) - (item.discount || 0);
    newSubtotal += Math.max(0, itemTotal);
  }
  const newGrandTotal = newSubtotal;

  // 2. Sync payment amount for cash/completed transactions
  const isCashOrPaid = paymentMode.toUpperCase() === "CASH" || paymentMode.toUpperCase() === "POS";
  const amountPaid = isCashOrPaid ? newGrandTotal : undefined;

  // 3. Update line items
  for (const item of updatedItems) {
    const itemTotal = (item.rate * item.quantity) - (item.discount || 0);
    await supabase
      .from("order_items")
      .update({
        unit_price: item.rate,
        line_total: Math.max(0, itemTotal)
      })
      .eq("order_id", orderId)
      .eq("sku", item.sku);
  }

  // 4. Update the order totals and status atomically
  const { data, error } = await supabase
    .from("orders")
    .update({
      total: newGrandTotal,
      subtotal: newSubtotal,
      ...(amountPaid !== undefined ? { amount_paid: amountPaid } : {}),
      payment_status: isCashOrPaid ? "paid" : "partial",
      updated_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to update bill: ${error.message}`);
  }

  return { success: true, order: data };
}
