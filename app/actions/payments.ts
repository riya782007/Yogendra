"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { attachInvoiceGrand } from "@/lib/supabase/queries";
import { billGrandPaise } from "@/lib/orderBill";

/** Record a payment (advance / partial / settlement) against an order, in rupees. */
export async function recordPaymentAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const orderId = String(formData.get("order_id") ?? "");
  const amount = Math.round((Number(formData.get("amount") ?? 0) || 0) * 100);
  if (!orderId || !amount) return;
  const sb = supabaseServer();

  // The payment is attributed to a SPECIFIC account (Cash / UPI / Kotak / SBI / HDFC …) chosen on the
  // bill, so each bank's balance updates separately and the record shows exactly which bank received it.
  const methodId = String(formData.get("method_id") ?? "").trim();
  let method: { id: string; name: string; kind: string } | null = null;
  if (methodId) {
    const { data } = await sb.from("payment_methods").select("id,name,kind").eq("id", methodId).maybeSingle();
    method = (data as any) ?? null;
  }
  // Cash keeps 'cash' (updates cash-in-hand); any bank/UPI account passes its NAME so the ledger and
  // bill show which bank got the money instead of a generic "bank".
  const legacyMode = ["cash", "bank", "upi"].includes(String(formData.get("mode"))) ? String(formData.get("mode")) : "cash";
  const pMode = method ? (method.kind === "cash" ? "cash" : method.name) : legacyMode;

  const { data: before } = await sb.from("orders").select("amount_paid").eq("id", orderId).maybeSingle();
  const paidBefore = ((before as any)?.amount_paid) ?? 0;
  await sb.rpc("record_payment", { p_order: orderId, p_amount: amount, p_mode: pMode });

  // Post to the chosen account's ledger (per-bank balances) with the exact amount actually applied
  // (record_payment caps at the grand total, so a duplicate/overpay attempt posts nothing).
  if (method) {
    const { data: after } = await sb.from("orders").select("amount_paid").eq("id", orderId).maybeSingle();
    const applied = (((after as any)?.amount_paid) ?? paidBefore) - paidBefore;
    if (applied > 0) {
      await sb.from("payment_method_transactions").insert({
        method_id: method.id, txn_type: "sale", direction: "in", amount: applied,
        ref_type: "order", ref_id: orderId, note: `Bill payment (${method.name})`, created_by: "owner",
      }).then(() => {}, () => {});
    }
  }
  revalidatePath(`/admin/invoice/${orderId}`); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/cashbook"); revalidatePath("/admin/payment-methods");
}

/**
 * Close a bill whose last few rupees were never paid, and never will be.
 *
 * Yogendra: "kabhi customer upar ke 20-30 nhi deta. To wha 22030 ka bill bna do 22000 recieved krke
 * wo partial payment me dikhata h." The bill is right, the money received is right, but the shop was
 * left with a permanent "Partial" flag and a ₹30 receivable nobody will ever collect.
 *
 * The printed bill is NOT altered — the customer was billed ₹22,030 and that stays true, GST and all.
 * Only the shop's own view of the bill is settled. Deliberately NOT routed through `record_payment`:
 * that RPC credits the cash book and bumps pay_cash/pay_bank, which would invent ₹30 of income that
 * never arrived. Nothing is written to the account ledger either, so every bank balance is untouched.
 *
 * Guarded to settling a SHORT payment: something must already have been received, so a single misclick
 * can never wipe out a fully unpaid bill.
 */
export async function writeOffBillBalanceAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const orderId = String(formData.get("order_id") ?? "");
  if (!orderId) return;
  const sb = supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,total,amount_paid,bill_type,gst_mode,status,admin_note,channel").eq("id", orderId).maybeSingle();
  const o = data as any;
  if (!o || o.status === "cancelled") return;
  await attachInvoiceGrand([o]); // dealer bills: total already includes GST — use the printed grand

  // The grand total the customer actually owes — the same figure the printed invoice shows
  // (lib/orderBill): 3% on top only for a bill pinned exclusive; a bill with no mode set is inclusive.
  const grand = billGrandPaise(o);
  const paid = (o.amount_paid ?? 0) as number;
  const shortfall = grand - paid;
  if (paid <= 0 || shortfall <= 0) return;

  const stamp = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const trail = `Balance ₹${(shortfall / 100).toFixed(2)} written off on ${stamp} (discount — not received).`;
  await sb.from("orders").update({
    amount_paid: grand,
    admin_note: o.admin_note ? `${o.admin_note}\n${trail}` : trail,
  }).eq("id", orderId);

  revalidatePath(`/admin/invoice/${orderId}`); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
}

/** Pillar 9: set the opening cash-in-hand and bank balances for the cash book (₹ → paise). */
export async function setCashBankOpeningAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("analytics.view"))) return;
  const cash = Math.max(0, Math.round((Number(formData.get("opening_cash") ?? 0) || 0) * 100));
  const bank = Math.max(0, Math.round((Number(formData.get("opening_bank") ?? 0) || 0) * 100));
  await supabaseServer().from("doc_settings").update({ opening_cash: cash, opening_bank: bank }).eq("id", 1);
  revalidatePath("/admin/cashbook");
}

/** Save an internal note on an order (#5/#34) — admin reference only, never printed. */
export async function saveOrderNoteAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const orderId = String(formData.get("order_id") ?? "");
  const note = String(formData.get("admin_note") ?? "").trim() || null;
  if (!orderId) return;
  await supabaseServer().from("orders").update({ admin_note: note }).eq("id", orderId);
  revalidatePath(`/admin/invoice/${orderId}`);
}

/** Convert a bill between Cash Memo and GST Tax Invoice (both ways) — customers change
 *  their mind mid-billing. Assigns an invoice number when becoming a GST invoice. */
export async function setBillTypeAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.gst"))) return;
  const orderId = String(formData.get("order_id") ?? "");
  const billType = String(formData.get("bill_type") ?? "") === "gst" ? "gst" : "cash";
  if (!orderId) return;
  const sb = supabaseServer();
  await sb.from("orders").update({ bill_type: billType }).eq("id", orderId);
  if (billType === "gst") {
    const { data: o } = await sb.from("orders").select("invoice_no").eq("id", orderId).maybeSingle();
    if (!(o as any)?.invoice_no) await sb.rpc("assign_invoice_no", { p_order: orderId });
  }
  revalidatePath(`/admin/invoice/${orderId}`); revalidatePath("/admin/sales");
}

/** Switch a bill between Proforma and final Tax Invoice. */
export async function setDocTypeAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.gst"))) return;
  const orderId = String(formData.get("order_id") ?? "");
  const docType = String(formData.get("doc_type") ?? "") === "proforma" ? "proforma" : "invoice";
  if (!orderId) return;
  const sb = supabaseServer();
  await sb.from("orders").update({ doc_type: docType }).eq("id", orderId);
  // Assign a real invoice number when finalising a tax invoice.
  if (docType === "invoice") await sb.rpc("assign_invoice_no", { p_order: orderId });
  revalidatePath(`/admin/invoice/${orderId}`);
}

/** Pillar 3 — choose how GST is shown on a tax invoice:
 *   'exclusive' → rate is pre-tax, GST added on top (taxable + GST = grand total)
 *   'inclusive' → rate already includes GST (back-computed from the stored total)
 *   'auto'      → clear the override; fall back to the channel default
 *                 (wholesale = exclusive, retail/pos = inclusive). */
export async function setGstModeAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.gst"))) return;
  const orderId = String(formData.get("order_id") ?? "");
  const raw = String(formData.get("gst_mode") ?? "");
  const gst_mode = raw === "exclusive" ? "exclusive" : raw === "inclusive" ? "inclusive" : null;
  if (!orderId) return;
  await supabaseServer().from("orders").update({ gst_mode }).eq("id", orderId);
  revalidatePath(`/admin/invoice/${orderId}`);
}

/**
 * Delete a wrong payment / debit entry from a customer's ledger — owner only.
 *
 * Owner, Oct 2026: "record payment par galti se do baar click kar diya, ab ledger galat hai, edit ka
 * koi option nahi. Owner ke paas entry delete ya change karne ka option hona chahiye."
 * Undoes exactly what Receive payment did: each bill it settled gets that amount back as unpaid (cash or
 * bank side, by the account it went into), the account entries are removed (so Bank & Cash drops the
 * money too), and an advance or debit entry is simply removed. To correct an amount, delete the entry
 * and record it again. Only entries that belong to THIS customer can be removed.
 */
export async function deleteLedgerEntryAction(formData: FormData): Promise<void> {
  if (!getSession().isOwner) return;
  const customerId = String(formData.get("customer_id") ?? "").trim();
  const ids = String(formData.get("txn_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!customerId || !ids.length) return;
  const sb = supabaseServer();
  const { data: cust } = await sb.from("customers").select("id,phone").eq("id", customerId).maybeSingle();
  if (!cust) return;
  const { data: rows } = await sb.from("payment_method_transactions").select("id,amount,direction,ref_type,ref_id,method_id,occurred_at").in("id", ids);
  const txns = ((rows as any[]) ?? []);
  if (!txns.length) return;

  const orderIds = [...new Set(txns.filter((t) => t.ref_type === "order").map((t) => t.ref_id))];
  const { data: ords } = orderIds.length
    ? await sb.from("orders").select("id,customer_id,customer_phone,amount_paid,pay_cash,pay_bank,invoice_no").in("id", orderIds)
    : { data: [] as any[] };
  const orderById = new Map<string, any>(((ords as any[]) ?? []).map((o) => [o.id, o]));
  const mine = (t: any) => t.ref_type === "customer"
    ? t.ref_id === customerId
    : t.ref_type === "order" && !!orderById.get(t.ref_id)
      && (orderById.get(t.ref_id).customer_id === customerId || (!!(cust as any).phone && orderById.get(t.ref_id).customer_phone === (cust as any).phone));
  const ok = txns.filter(mine);
  if (!ok.length) return;

  const methodIds = [...new Set(ok.map((t) => t.method_id).filter(Boolean))];
  const { data: pms } = methodIds.length ? await sb.from("payment_methods").select("id,kind").in("id", methodIds) : { data: [] as any[] };
  const isCash = new Map<string, boolean>(((pms as any[]) ?? []).map((m) => [m.id, String(m.kind ?? "").toLowerCase() === "cash"]));

  // Money that had settled a bill goes back onto that bill as unpaid.
  for (const t of ok) {
    if (t.ref_type !== "order" || t.direction !== "in") continue;
    const o = orderById.get(t.ref_id);
    const amt = Number(t.amount) || 0;
    const cash = isCash.get(t.method_id) ?? false;
    const patch: Record<string, number> = { amount_paid: Math.max(0, (o.amount_paid ?? 0) - amt) };
    if (cash) patch.pay_cash = Math.max(0, (o.pay_cash ?? 0) - amt); else patch.pay_bank = Math.max(0, (o.pay_bank ?? 0) - amt);
    await sb.from("orders").update(patch).eq("id", o.id);
    o.amount_paid = patch.amount_paid; if (cash) o.pay_cash = patch.pay_cash; else o.pay_bank = patch.pay_bank;
  }
  await sb.from("payment_method_transactions").delete().in("id", ok.map((t) => t.id));

  const total = ok.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const bills = ok.filter((t) => t.ref_type === "order").map((t) => orderById.get(t.ref_id)?.invoice_no || String(t.ref_id).slice(0, 8).toUpperCase());
  await sb.from("audit_log").insert({
    actor: "owner", action: "ledger_entry_deleted", ref: customerId,
    detail: `Deleted ledger entry ₹${Math.round(total / 100)} (${ok[0].direction === "in" ? "payment" : "debit"} dated ${String(ok[0].occurred_at).slice(0, 10)})${bills.length ? ` — bills reopened: ${bills.join(", ")}` : ""}`,
  }).then(() => {}, () => {});

  revalidatePath(`/admin/customer/${customerId}`); revalidatePath("/admin/creditors"); revalidatePath("/admin/sales");
  revalidatePath("/admin/cashbook"); revalidatePath("/admin/payment-methods"); revalidatePath("/admin/customers");
  for (const id of orderIds) revalidatePath(`/admin/invoice/${id}`);
}
