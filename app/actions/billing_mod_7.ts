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

/** "YYYY-MM-DD" from the owner → the instant the money moved. Today keeps the real time; a past
 *  date is stamped at noon IST so it lands on that day in every report. Future dates are refused. */
function paymentInstant(date?: string | null): { iso: string } | { error: string } {
  const d = (date ?? "").trim();
  if (!d) return { iso: new Date().toISOString() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: "Pick a valid date." };
  const todayIst = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (d > todayIst) return { error: "The date can't be in the future." };
  if (d < "2015-01-01") return { error: "That date is too far back." };
  return { iso: d === todayIst ? new Date().toISOString() : new Date(`${d}T12:00:00+05:30`).toISOString() };
}

/**
 * Receive payment / record a ledger entry for a customer.
 *
 * Owner (Oct 2026): "recieve payment me date dedo and debit credit types bna do" + "past payment
 * chadane ho to bhi". So this now takes:
 *   - date   any past day (default today) — the money is booked on that day in the account ledger
 *   - kind   "credit" (default) = money RECEIVED from the customer: settles the oldest open bills
 *            first, exactly as before; anything left over is kept as an ADVANCE on the customer's
 *            ledger (it used to vanish from Bank & Cash — the account never saw that money).
 *            "debit" = the customer owes MORE: money paid out to them from an account, or (no account)
 *            an old balance / charge entered by hand. Never touches a bill.
 * Bills are only ever changed by a credit, in the same way they always were.
 */
export async function receiveCustomerPaymentAction(input: {
  customerId?: string | null; phone?: string | null; amountRupees: number; method: "cash" | "upi" | "bank";
  methodId?: string | null; note?: string; kind?: "credit" | "debit"; date?: string | null; asAdvance?: boolean;
}): Promise<{ ok: boolean; allocated?: { invoice: string; paise: number }[]; leftoverPaise?: number; advancePaise?: number; error?: string; noOpenBills?: boolean }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't receive payments." };
  const paise = Math.round((input.amountRupees ?? 0) * 100);
  if (!Number.isFinite(paise) || paise <= 0) return { ok: false, error: "Enter the amount." };
  if (!input.customerId && !input.phone) return { ok: false, error: "Missing customer" };
  const when = paymentInstant(input.date);
  if ("error" in when) return { ok: false, error: when.error };
  const kind = input.kind === "debit" ? "debit" : "credit";
  const note = (input.note ?? "").trim() || null;
  const sb = supabaseServer();

  const methodId = (input.methodId ?? "").trim() || null;
  let toCash = input.method === "cash";
  let methodName = "";
  if (methodId) {
    const { data: pm } = await sb.from("payment_methods").select("kind,name").eq("id", methodId).maybeSingle();
    if (pm) { toCash = String((pm as any).kind ?? "").toLowerCase() === "cash"; methodName = (pm as any).name ?? ""; }
  }
  const dateTag = input.date ? ` on ${input.date}` : "";
  const done = () => {
    revalidatePath("/admin/creditors"); revalidatePath("/admin/sales"); revalidatePath("/admin/customers");
    revalidatePath("/admin/cashbook"); revalidatePath("/admin/payment-methods");
    if (input.customerId) revalidatePath(`/admin/customer/${input.customerId}`);
  };

  // ---- DEBIT: customer owes more. Lives on the customer's ledger only; bills are untouched. ----
  if (kind === "debit") {
    if (!input.customerId) return { ok: false, error: "Open the customer's page to add a debit entry." };
    if (!methodId && !note) return { ok: false, error: "Add a note saying what this debit is for." };
    const { error } = await sb.from("payment_method_transactions").insert({
      method_id: methodId, txn_type: methodId ? "refund" : "adjustment", direction: "out", amount: paise,
      ref_type: "customer", ref_id: input.customerId, note, created_by: "owner", occurred_at: when.iso,
    });
    if (error) return { ok: false, error: error.message };
    await sb.from("audit_log").insert({
      actor: "owner", action: "customer_debit", ref: input.customerId,
      detail: `Debit ₹${Math.round(paise / 100)}${methodName ? ` paid from ${methodName}` : " (no money moved)"}${dateTag}${note ? ` — ${note}` : ""}`,
    }).then(() => {}, () => {});
    done();
    return { ok: true, allocated: [], leftoverPaise: 0 };
  }

  // ---- CREDIT: money received. Oldest open bill first, as before. ----
  const sel = "id,invoice_no,total,amount_paid,bill_type,gst_mode,status,pay_cash,pay_bank,created_at";
  const byId = input.customerId ? await sb.from("orders").select(sel).eq("customer_id", input.customerId).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const byPhone = input.phone ? await sb.from("orders").select(sel).eq("customer_phone", input.phone).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const seen = new Set<string>();
  const orders = [...(((byId.data as any[]) ?? [])), ...(((byPhone.data as any[]) ?? []))]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .filter((o) => o.status !== "cancelled")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const credits = await returnCreditsByOrder(orders.map((o) => o.id));
  const openDue = orders.reduce((s, o) => s + orderReceivable(o, credits.get(o.id) ?? 0), 0);
  // Nothing open: don't silently park money — the owner confirms it is an advance (on account).
  if (openDue <= 0 && !input.asAdvance) {
    return { ok: false, noOpenBills: true, error: "No open bills for this customer. Save it as an advance (on account)?" };
  }
  if (openDue <= 0 && !input.customerId) return { ok: false, error: "Open the customer's page to record an advance." };

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
        ref_type: "order", ref_id: o.id, note, created_by: "owner", occurred_at: when.iso,
      }).then(() => {}, () => {});
    }
    allocated.push({ invoice: o.invoice_no || String(o.id).slice(0, 8).toUpperCase(), paise: alloc });
    remaining -= alloc;
  }

  // Whatever no bill needed is still money in the account: keep it as an advance on the customer.
  let advancePaise = 0;
  if (remaining > 0 && input.customerId) {
    const { error } = await sb.from("payment_method_transactions").insert({
      method_id: methodId, txn_type: "payment", direction: "in", amount: remaining,
      ref_type: "customer", ref_id: input.customerId, note: note ?? "Advance (no open bill)", created_by: "owner", occurred_at: when.iso,
    });
    if (!error) { advancePaise = remaining; remaining = 0; }
  }

  await sb.from("audit_log").insert({
    actor: "owner", action: "payment_in",
    ref: input.customerId ?? input.phone ?? "",
    detail: `Received ₹${Math.round(paise / 100)} (${methodName || input.method})${dateTag}${note ? ` — ${note}` : ""} → ${allocated.map((a) => `${a.invoice} ₹${Math.round(a.paise / 100)}`).join(", ") || "no open bill"}${advancePaise > 0 ? ` · ₹${Math.round(advancePaise / 100)} kept as advance` : ""}${remaining > 0 ? ` · ₹${Math.round(remaining / 100)} unallocated` : ""}`,
  }).then(() => {}, () => {});

  done();
  return { ok: true, allocated, leftoverPaise: remaining, advancePaise };
}
