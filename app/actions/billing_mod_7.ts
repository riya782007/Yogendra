"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export async function receiveCustomerPaymentAction(input: { customerId?: string | null; phone?: string | null; amountRupees: number; method: "cash" | "upi" | "bank"; methodId?: string | null; note?: string }): Promise<{ ok: boolean; allocated?: { invoice: string; paise: number }[]; leftoverPaise?: number; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't receive payments." };
  const paise = Math.round((input.amountRupees ?? 0) * 100);
  if (!Number.isFinite(paise) || paise <= 0) return { ok: false, error: "Enter the amount received." };
  if (!input.customerId && !input.phone) return { ok: false, error: "Missing customer" };
  const sb = supabaseServer();

  const methodId = (input.methodId ?? "").trim() || null;
  let toCash = input.method === "cash";
  if (methodId) {
    const { data: pm } = await sb.from("payment_methods").select("kind").eq("id", methodId).maybeSingle();
    if (pm) toCash = String((pm as any).kind ?? "").toLowerCase() === "cash";
  }

  const sel = "id,invoice_no,total,amount_paid,bill_type,gst_mode,status,pay_cash,pay_bank,created_at";
  const byId = input.customerId ? await sb.from("orders").select(sel).eq("customer_id", input.customerId).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const byPhone = input.phone ? await sb.from("orders").select(sel).eq("customer_phone", input.phone).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const seen = new Set<string>();
  const orders = [...(((byId.data as any[]) ?? [])), ...(((byPhone.data as any[]) ?? []))]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .filter((o) => o.status !== "cancelled")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const credits = await returnCreditsByOrder(orders.map((o) => o.id));
  let remaining = paise;
  const allocated: { invoice: string; paise: number }[] = [];
  for (const o of orders) {
    if (remaining <= 0) break;
    const due = orderReceivable(o, credits.get(o.id) ?? 0);
    if (due <= 0) continue;
    const alloc = Math.min(due, remaining);
    const patch: Record<string, number> = { amount_paid: (o.amount_paid ?? 0) + alloc };
    if (toCash) patch.pay_cash = (o.pay_cash ?? 0) + alloc;
    else patch.pay_bank = (o.pay_bank ?? 0) + alloc;
    const { error } = await sb.from("orders").update(patch).eq("id", o.id);
    if (error) return { ok: false, error: error.message };
    if (methodId) {
      await sb.from("payment_method_transactions").insert({
        method_id: methodId, txn_type: "payment", direction: "in", amount: alloc,
        ref_type: "order", ref_id: o.id, note: (input.note ?? "").trim() || null,
        created_by: "owner", occurred_at: new Date().toISOString(),
      }).then(() => {}, () => {});
    }
    allocated.push({ invoice: o.invoice_no || String(o.id).slice(0, 8).toUpperCase(), paise: alloc });
    remaining -= alloc;
  }
  if (!allocated.length) return { ok: false, error: "No outstanding bills found for this customer." };

  await sb.from("audit_log").insert({
    actor: "owner", action: "payment_in",
    ref: input.customerId ?? input.phone ?? "",
    detail: `Received ₹${Math.round(paise / 100)} (${input.method})${input.note ? ` — ${input.note}` : ""} → ${allocated.map((a) => `${a.invoice} ₹${Math.round(a.paise / 100)}`).join(", ")}${remaining > 0 ? ` · ₹${Math.round(remaining / 100)} unallocated (advance)` : ""}`,
  }).then(() => {}, () => {});

  revalidatePath("/admin/creditors"); revalidatePath("/admin/sales"); revalidatePath("/admin/customers");
  if (input.customerId) revalidatePath(`/admin/customer/${input.customerId}`);
  return { ok: true, allocated, leftoverPaise: remaining };
}
