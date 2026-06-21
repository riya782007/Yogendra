"use server";
import { supabaseServer } from "@/lib/supabase/server";

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
  return { ok: true, orderId: (data as any)?.order_id, total: (data as any)?.total };
}

export async function posSaleAction(input: { items: { sku: string; qty: number }[]; customer: { name?: string; phone?: string }; payment: string }): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("place_order", {
    p_items: input.items, p_customer: input.customer ?? {}, p_channel: "pos", p_payment: input.payment || "cash",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, orderId: (data as any)?.order_id, total: (data as any)?.total };
}
