"use server";
/**
 * Trade-visitor lead capture.
 *
 * The wholesale catalogue is open to browse — dealers were bouncing rather than hand over a phone
 * number before they could see a single rate. We ask for details only once the visitor has shown real
 * interest, and record them here so the owner can see (and follow up with) everyone who looked.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

export async function captureTradeVisitorAction(input: {
  name: string; phone: string; city?: string;
  visitorId?: string; designsViewed?: number; activeSeconds?: number; reason?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const name = (input.name ?? "").trim().slice(0, 120);
  const phone = (input.phone ?? "").replace(/[^\d+]/g, "").slice(0, 20);
  if (name.length < 2) return { ok: false, error: "Please enter your name." };
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "Please enter a valid phone number." };

  const row: any = {
    name,
    phone,
    city: (input.city ?? "").trim().slice(0, 80) || null,
    visitor_id: (input.visitorId ?? "").trim().slice(0, 64) || null,
    designs_viewed: Math.max(0, Math.round(Number(input.designsViewed) || 0)),
    active_seconds: Math.max(0, Math.round(Number(input.activeSeconds) || 0)),
    trigger_reason: (input.reason ?? "").slice(0, 40) || null,
    status: "new",
  };

  const sb = supabaseServer();
  // A returning visitor updates their own row rather than creating a duplicate lead.
  let res = row.visitor_id
    ? await (sb.from("trade_visitors") as any).upsert(row, { onConflict: "visitor_id" })
    : await (sb.from("trade_visitors") as any).insert(row);
  if (res.error) {
    delete row.visitor_id;
    res = await (sb.from("trade_visitors") as any).insert(row);
    if (res.error) return { ok: false, error: res.error.message };
  }
  revalidatePath("/admin/visitors");
  return { ok: true };
}

/** Owner-side: work the list — contacted / approved / ignored. */
export async function updateTradeVisitorAction(input: { id: string; status: string; adminNote?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "not permitted" };
  const status = ["new", "contacted", "approved", "ignored"].includes(input.status) ? input.status : "new";
  const { error } = await (supabaseServer().from("trade_visitors") as any).update({
    status,
    admin_note: (input.adminNote ?? "").trim() || null,
    handled_at: status === "new" ? null : new Date().toISOString(),
  }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/visitors");
  return { ok: true };
}
