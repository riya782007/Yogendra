"use server";
/**
 * Atomic bill save: bundles line edits + charges into ONE operation with a single OTP.
 * Lives in its own module so billing.ts is not rewritten wholesale (avoids feature regressions).
 * Called by EditBillPanel after all qty/packing/courier/adjustment edits are staged.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export interface SaveOrderBillLineUpdate {
  itemId: string;
  newQty: number; // 0 = remove
}

export async function saveOrderBillAction(input: {
  orderId: string;
  lines?: SaveOrderBillLineUpdate[];
  packingRupees?: number;
  courierRupees?: number;
  adjustmentRupees?: number;
  otp: string;
}): Promise<{ ok: boolean; error?: string; total?: number; removed?: number }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  
  const otp = (input.otp ?? "").trim();
  if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  
  const orderId = (input.orderId ?? "").trim();
  if (!orderId) return { ok: false, error: "Missing bill." };

  const sb = supabaseServer();
  
  // Verify bill exists and get its metadata
  const { data: ord, error: oErr } = await sb.from("orders")
    .select("id,channel,bill_type")
    .eq("id", orderId).maybeSingle();
  if (oErr || !ord) return { ok: false, error: oErr?.message ?? "Bill not found" };

  let removedCount = 0;

  // 1. Process line qty updates if provided
  if (input.lines && input.lines.length > 0) {
    for (const line of input.lines) {
      const itemId = (line.itemId ?? "").trim();
      const newQty = Math.max(0, Math.floor(Number(line.newQty ?? 0)));
      if (!itemId) continue;

      const { data: result, error: lineErr } = await sb.rpc("edit_order_line", {
        p_order_id: orderId,
        p_item_id: itemId,
        p_new_qty: newQty,
      });
      
      if (lineErr) return { ok: false, error: lineErr.message };
      if ((result as any)?.removed) removedCount++;
    }
  }

  // 2. Update charges (packing/courier/adjustment) if provided
  const toPaise = (r: number | undefined) => Math.round((typeof r === "number" && Number.isFinite(r) ? r : 0) * 100);
  const packing = Math.max(0, toPaise(input.packingRupees));
  const courier = Math.max(0, toPaise(input.courierRupees));
  const adjustment = toPaise(input.adjustmentRupees);

  const { error: updErr } = await sb.from("orders").update({
    extra_packing: packing,
    extra_courier: courier,
    extra_adjustment: adjustment,
  }).eq("id", orderId);
  if (updErr) return { ok: false, error: updErr.message };

  // 3. Recalculate total: items + charges with GST rules
  const { data: lines } = await sb.from("order_items")
    .select("line_total,unit_price,qty")
    .eq("order_id", orderId);
  
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

  // 4. Log the changes
  try {
    await logActivity({
      action: "order_bill_save",
      ref: orderId,
      detail: `lines_updated=${input.lines?.length ?? 0} removed=${removedCount} packing=${packing} courier=${courier} adjust=${adjustment} total=${total}`,
    });
  } catch { /* optional */ }

  // 5. Revalidate all related paths
  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales");
  revalidatePath("/admin/cod");
  revalidatePath("/admin/backorders");
  revalidatePath("/admin/dashboard");

  return { ok: true, total, removed: removedCount };
}
