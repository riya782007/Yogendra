"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { getWholesaleSession } from "@/lib/wholesale";

const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: true, path: "/", maxAge: 60 * 60 * 12 };

function genCode(): string {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** Wholesale customer logs in with phone + access code (must be approved). */
export async function wholesaleLoginAction(formData: FormData) {
  const phone = String(formData.get("phone") ?? "").trim();
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!phone || !code) redirect("/wholesale?error=1");
  const { data } = await supabaseServer()
    .from("customers").select("id")
    .eq("type", "wholesale").eq("wholesale_approved", true).eq("phone", phone).eq("login_code", code)
    .maybeSingle();
  if (!data) redirect("/wholesale?error=1");
  cookies().set("bd_wholesale", (data as any).id, COOKIE);
  redirect("/wholesale");
}

export async function wholesaleLogoutAction() {
  cookies().set("bd_wholesale", "", { httpOnly: true, path: "/", maxAge: 0 });
  redirect("/wholesale");
}

/** Owner: approve/revoke wholesale access and (re)issue an access code. */
export async function approveWholesaleAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const approve = String(formData.get("approve") ?? "") === "1";
  if (!id) return;
  const sb = supabaseServer();
  if (approve) {
    const { data: cur } = await sb.from("customers").select("login_code").eq("id", id).maybeSingle();
    const code = (cur as any)?.login_code || genCode();
    await sb.from("customers").update({ wholesale_approved: true, type: "wholesale", login_code: code }).eq("id", id);
  } else {
    await sb.from("customers").update({ wholesale_approved: false }).eq("id", id);
  }
  revalidatePath(`/admin/customer/${id}`); revalidatePath("/admin/customers");
}

export async function regenWholesaleCodeAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await supabaseServer().from("customers").update({ login_code: genCode() }).eq("id", id);
  revalidatePath(`/admin/customer/${id}`);
}

/** Place a wholesale order. Prices are recomputed server-side at the wholesale rate. */
export async function placeWholesaleOrderAction(items: { sku: string; qty: number }[]): Promise<{ ok: boolean; orderId?: string; total?: number; error?: string }> {
  const sess = await getWholesaleSession();
  if (!sess) return { ok: false, error: "Please log in as an approved wholesale customer." };
  const clean = (items ?? []).filter((i) => i.sku && i.qty > 0).map((i) => ({ sku: i.sku, qty: Math.floor(i.qty) }));
  if (!clean.length) return { ok: false, error: "Enter quantities for at least one product." };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("place_wholesale_order", { p_customer: sess.id, p_items: clean, p_allow_oversell: false });
  if (error) return { ok: false, error: error.message };
  const orderId = (data as any)?.order_id;
  if (orderId) await sb.rpc("assign_invoice_no", { p_order: orderId });
  revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  return { ok: true, orderId, total: (data as any)?.total };
}
