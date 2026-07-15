"use server";
/**
 * Voucher / coupon engine. validateVoucher is the single source of truth for a code's discount and is
 * ALWAYS re-run server-side at order time (never trust a client-sent discount). Admin CRUD lets the
 * owner create % or flat codes with a min-order, a cap, a channel, a schedule and a usage limit.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

export type VoucherCheck = { ok: boolean; discountPaise: number; code?: string; message?: string };

/** Core validator (server-only). Returns the discount in paise for a given cart subtotal + channel. */
export async function validateVoucher(code: string, subtotalPaise: number, channel: "retail" | "wholesale"): Promise<VoucherCheck & { id?: string; used_count?: number; usage_limit?: number | null }> {
  const c = (code ?? "").trim();
  if (!c) return { ok: false, discountPaise: 0, message: "Enter a coupon code." };
  const sb = supabaseServer();
  const { data } = await sb.from("vouchers").select("*").ilike("code", c).limit(1);
  const v = (data as any[])?.[0];
  if (!v) return { ok: false, discountPaise: 0, message: "Invalid coupon code." };
  if (!v.active) return { ok: false, discountPaise: 0, message: "This coupon is no longer active." };
  const now = Date.now();
  if (v.starts_at && new Date(v.starts_at).getTime() > now) return { ok: false, discountPaise: 0, message: "This coupon isn't active yet." };
  if (v.ends_at && new Date(v.ends_at).getTime() < now) return { ok: false, discountPaise: 0, message: "This coupon has expired." };
  if (v.usage_limit != null && (v.used_count ?? 0) >= v.usage_limit) return { ok: false, discountPaise: 0, message: "This coupon has reached its limit." };
  if (v.channel && v.channel !== "all" && v.channel !== channel) return { ok: false, discountPaise: 0, message: "This coupon isn't valid here." };
  if (subtotalPaise < (v.min_order ?? 0)) return { ok: false, discountPaise: 0, message: `Add ₹${Math.round(((v.min_order ?? 0) - subtotalPaise) / 100).toLocaleString("en-IN")} more to use this coupon.` };
  let discount = v.kind === "percent" ? Math.round(subtotalPaise * (Number(v.value) || 0) / 100) : Number(v.value) || 0;
  if (v.max_discount != null && v.max_discount > 0) discount = Math.min(discount, v.max_discount);
  discount = Math.max(0, Math.min(discount, subtotalPaise)); // never exceed the cart, never negative
  if (discount <= 0) return { ok: false, discountPaise: 0, message: "This coupon gives no discount on this order." };
  return { ok: true, discountPaise: discount, code: v.code, id: v.id, used_count: v.used_count, usage_limit: v.usage_limit, message: `Coupon applied — you save ₹${Math.round(discount / 100).toLocaleString("en-IN")}!` };
}

/** Public: preview a coupon at checkout (no auth). Returns the discount for the shown subtotal. */
export async function validateVoucherAction(input: { code: string; subtotalPaise: number; channel?: "retail" | "wholesale" }): Promise<VoucherCheck> {
  const r = await validateVoucher(input.code, Math.max(0, Math.floor(input.subtotalPaise || 0)), input.channel ?? "retail");
  return { ok: r.ok, discountPaise: r.discountPaise, code: r.code, message: r.message };
}

/** Owner: increment a voucher's redemption count after an order actually uses it. Best-effort. */
export async function bumpVoucherUsage(code: string): Promise<void> {
  const c = (code ?? "").trim();
  if (!c) return;
  const sb = supabaseServer();
  const { data } = await sb.from("vouchers").select("id,used_count").ilike("code", c).limit(1);
  const v = (data as any[])?.[0];
  if (v) await sb.from("vouchers").update({ used_count: (v.used_count ?? 0) + 1 }).eq("id", v.id).then(() => {}, () => {});
}

// ---------- Admin CRUD ----------
export async function createVoucherAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit"))) return;
  const code = String(formData.get("code") ?? "").trim().toUpperCase().replace(/\s+/g, "");
  if (code.length < 3) return;
  const kind = String(formData.get("kind") ?? "percent") === "flat" ? "flat" : "percent";
  const rawValue = Number(formData.get("value") ?? 0) || 0;
  const value = kind === "percent" ? Math.max(1, Math.min(100, Math.round(rawValue))) : Math.round(rawValue * 100); // flat entered in ₹
  const minOrder = Math.round((Number(formData.get("min_order") ?? 0) || 0) * 100);
  const maxDisc = Number(formData.get("max_discount") ?? 0) || 0;
  const channel = ["all", "retail", "wholesale"].includes(String(formData.get("channel"))) ? String(formData.get("channel")) : "all";
  const usageLimit = Number(formData.get("usage_limit") ?? 0) || 0;
  const endsAt = String(formData.get("ends_at") ?? "").trim();
  const row: any = {
    code, kind, value, min_order: minOrder, channel,
    max_discount: kind === "percent" && maxDisc > 0 ? Math.round(maxDisc * 100) : null,
    usage_limit: usageLimit > 0 ? usageLimit : null,
    ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    active: true,
  };
  const sb = supabaseServer();
  await sb.from("vouchers").upsert(row, { onConflict: "code" });
  revalidatePath("/admin/vouchers");
}

export async function toggleVoucherAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit"))) return;
  const id = String(formData.get("id") ?? "");
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return;
  await supabaseServer().from("vouchers").update({ active }).eq("id", id);
  revalidatePath("/admin/vouchers");
}

export async function deleteVoucherAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.price_edit"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabaseServer().from("vouchers").delete().eq("id", id);
  revalidatePath("/admin/vouchers");
}
