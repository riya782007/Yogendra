"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export async function createSupplierAction(formData: FormData) {
  if (!(await requirePerm("purchases.create"))) return;
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  if (!name) return;
  await supabaseServer().from("suppliers").insert({ name, city: city || null });
  revalidatePath("/admin/purchases");
}

/** Low-risk edit of a purchase's bill number / supplier — direct, permissioned. */
export async function updatePurchaseAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("purchases.create"))) return;
  const id = String(formData.get("id") ?? "");
  const billNo = String(formData.get("bill_no") ?? "").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!id) return;
  const row: any = { bill_no: billNo || null };
  if (supplierId) row.supplier_id = supplierId;
  await supabaseServer().from("purchases").update(row).eq("id", id);
  revalidatePath(`/admin/purchase/${id}`); revalidatePath("/admin/purchases");
}

/**
 * Sensitive: deleting a purchase reverses stock & the ledger, so it can't be done directly —
 * it raises an approval request that the owner must clear with the OTP (2FA) on /admin/approvals.
 */
export async function requestPurchaseDeletionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("purchases.create"))) return;
  const id = String(formData.get("id") ?? "");
  const billNo = String(formData.get("bill_no") ?? "");
  if (!id) return;
  const sb = supabaseServer();
  // Avoid duplicate pending requests for the same purchase.
  const { data: dup } = await sb.from("approvals").select("id").eq("action", "delete_purchase").eq("status", "pending").contains("payload", { purchase_id: id }).maybeSingle();
  if (dup) { revalidatePath("/admin/approvals"); return; }
  await sb.from("approvals").insert({
    action: "delete_purchase",
    payload: { purchase_id: id, bill_no: billNo },
    status: "pending",
    otp_hash: `h:${OWNER_OTP()}`,
  });
  revalidatePath("/admin/approvals"); revalidatePath(`/admin/purchase/${id}`);
}

export type PurchaseLine = { supplierSku: string; mappedProductId: string; variantId?: string; qty: number; unitCostRupees: number };

/** One leg of a split payment made at purchase time. Several may be supplied at once. */
export type PurchasePayment = { mode: "cash" | "upi" | "bank"; amountRupees: number };

export async function recordPurchaseAction(input: {
  supplierId: string; billNo: string; items: PurchaseLine[]; force?: boolean;
  /** NEW: split the bill across several methods at once (cash + upi + bank). Remainder = credit. */
  payments?: PurchasePayment[];
  /** Legacy single-method fields — still accepted so older callers keep working. */
  paymentMode?: "cash" | "upi" | "bank" | "credit"; amountPaidRupees?: number;
}): Promise<{ ok: boolean; total?: number; error?: string; duplicateBillNo?: boolean }> {
  if (!input.supplierId) return { ok: false, error: "Choose a supplier" };
  const items = (input.items ?? []).filter((l) => l.qty > 0 && l.unitCostRupees > 0);
  if (!items.length) return { ok: false, error: "Add at least one line with qty and cost" };

  const sb = supabaseServer();
  const billNo = (input.billNo ?? "").trim();
  // Warn (don't hard-block — bills do get corrected/re-entered) if this supplier already has
  // a purchase under the same bill number, so the same invoice isn't double-booked by mistake.
  if (billNo && !input.force) {
    const { data: dup } = await sb.from("purchases").select("id, created_at").eq("supplier_id", input.supplierId).eq("bill_no", billNo).limit(1).maybeSingle();
    if (dup) {
      const when = dup.created_at ? new Date(dup.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "earlier";
      return { ok: false, duplicateBillNo: true, error: `Bill "${billNo}" was already recorded for this supplier on ${when}. Record it again anyway?` };
    }
  }

  const payload = items.map((l) => ({ supplier_sku: l.supplierSku, mapped_product_id: l.mappedProductId || "", variant_id: l.variantId || "", qty: l.qty, unit_cost: Math.round(l.unitCostRupees * 100) }));
  const { data, error } = await sb.rpc("record_purchase", { p_supplier_id: input.supplierId, p_bill_no: billNo || null, p_items: payload });
  if (error) return { ok: false, error: error.message };
  const total = (data as any)?.total as number;

  // Payment: whatever is paid now is recorded as one supplier_payment PER method (so a bill can be
  // split across cash + upi + bank in a single purchase); anything left unpaid stays owed on the
  // supplier ledger (credit). Best-effort — a payment hiccup never unwinds the recorded stock.
  //   • NEW callers pass `payments: [{mode, amountRupees}, …]`.
  //   • Legacy callers pass a single `paymentMode` + `amountPaidRupees`; we adapt it to one leg.
  const splits: PurchasePayment[] = (input.payments?.length)
    ? input.payments
    : (input.paymentMode && input.paymentMode !== "credit")
      ? [{ mode: input.paymentMode, amountRupees: input.amountPaidRupees ?? 0 }]
      : [];
  let remaining = Number(total) || 0; // paise still available to allocate (never over-pay the bill)
  for (const s of splits) {
    if (remaining <= 0) break;
    const want = Math.max(0, Math.round((Number(s.amountRupees) || 0) * 100));
    const paise = Math.min(want, remaining);
    if (paise <= 0) continue;
    const ledgerMode = s.mode === "cash" ? "cash" : s.mode === "upi" ? "upi" : "bank";
    const { error: payErr } = await sb.from("supplier_payments").insert({
      supplier_id: input.supplierId, amount: paise, mode: ledgerMode,
      ref: billNo || null, note: `Paid at purchase${billNo ? ` · bill ${billNo}` : ""}`,
    });
    if (payErr) console.warn("supplier payment not recorded (purchase still saved):", payErr.message);
    else remaining -= paise;
  }
  revalidatePath("/admin/purchases"); revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/supplier/${input.supplierId}`); revalidatePath("/admin/cashbook");
  return { ok: true, total };
}
