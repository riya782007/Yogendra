"use server";
/**
 * Packing / courier / adjustment on an issued bill (OTP-gated).
 * Lives in its own module so billing.ts is not rewritten wholesale (avoids feature regressions).
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export async function editOrderChargesAction(input: {
  orderId: string;
  packingRupees: number;
  courierRupees: number;
  adjustmentRupees: number;
  otp: string;
}): Promise<{ ok: boolean; error?: string; total?: number }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const otp = (input.otp ?? "").trim();
  if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  const orderId = (input.orderId ?? "").trim();
  if (!orderId) return { ok: false, error: "Missing bill." };

  const toPaise = (r: number) => Math.round((Number.isFinite(r) ? r : 0) * 100);
  const packing = Math.max(0, toPaise(input.packingRupees));
  const courier = Math.max(0, toPaise(input.courierRupees));
  const adjustment = toPaise(input.adjustmentRupees);

  const sb = supabaseServer();
  const { data: ord, error: oErr } = await sb.from("orders")
    .select("id,channel,bill_type")
    .eq("id", orderId).maybeSingle();
  if (oErr || !ord) return { ok: false, error: oErr?.message ?? "Bill not found" };

  const { error: updErr } = await sb.from("orders").update({
    extra_packing: packing,
    extra_courier: courier,
    extra_adjustment: adjustment,
  }).eq("id", orderId);
  if (updErr) return { ok: false, error: updErr.message };

  const { data: lines } = await sb.from("order_items").select("line_total,unit_price,qty").eq("order_id", orderId);
  let items = ((lines as any[]) ?? []).reduce(
    (s, r) => s + (r.line_total ?? (r.unit_price ?? 0) * (r.qty ?? 0)),
    0,
  );
  const channel = String((ord as any).channel ?? "").toLowerCase();
  const billType = String((ord as any).bill_type ?? "").toLowerCase();
  if (channel === "wholesale" && billType === "gst") {
    items = Math.round(items * 1.03);
  }
  const total = Math.max(0, items + packing + courier + adjustment);
  const { error: totErr } = await sb.from("orders").update({ total }).eq("id", orderId);
  if (totErr) return { ok: false, error: totErr.message };

  try {
    await logActivity({
      action: "order_charges_edit",
      ref: orderId,
      detail: `packing=${packing} courier=${courier} adjust=${adjustment} total=${total}`,
    });
  } catch { /* optional */ }

  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales");
  revalidatePath("/admin/cod");
  revalidatePath("/admin/dashboard");
  return { ok: true, total };
}

/** Load packing/courier/adjustment for the edit panel (paise). */
export async function fetchOrderChargesAction(orderId: string): Promise<{
  ok: boolean;
  error?: string;
  packing?: number;
  courier?: number;
  adjustment?: number;
}> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "not permitted" };
  const id = (orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing bill" };
  const sb = supabaseServer();
  const { data, error } = await sb.from("orders")
    .select("extra_packing,extra_courier,extra_adjustment")
    .eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Bill not found" };
  const o = data as any;
  return {
    ok: true,
    packing: o.extra_packing ?? 0,
    courier: o.extra_courier ?? 0,
    adjustment: o.extra_adjustment ?? 0,
  };
}
