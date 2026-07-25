"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

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
