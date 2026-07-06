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

/**
 * Map an unmapped purchase line to a product. An unmapped line never added its stock at purchase
 * time (there was no product to add to), so mapping it now applies that missing stock. The bill
 * total / ledger already counted this line, so money is untouched.
 */
export async function mapPurchaseLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("purchases.create"))) return;
  const lineId = String(formData.get("line_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const purchaseId = String(formData.get("purchase_id") ?? "").trim();
  if (!lineId || !productId) return;
  const sb = supabaseServer();
  await sb.rpc("map_purchase_line", { p_line_id: lineId, p_product: productId, p_variant: null });
  if (purchaseId) revalidatePath(`/admin/purchase/${purchaseId}`);
  revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
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

/** Lines of ONE purchase bill, with per-line returnable (bought − already returned to supplier). */
export async function fetchPurchaseForReturnAction(purchaseId: string): Promise<{ ok: boolean; error?: string; items?: { productId: string; variantId: string | null; name: string; sku: string; color: string | null; qty: number; returned: number; returnable: number; unitCost: number }[] }> {
  if (!(await requirePerm("purchases.manage"))) return { ok: false, error: "Your role can't manage purchases." };
  const id = (purchaseId ?? "").trim();
  if (!id) return { ok: false, error: "Missing purchase" };
  const sb = supabaseServer();
  const [{ data: items, error }, { data: rets }] = await Promise.all([
    sb.from("purchase_items").select("qty,unit_cost,mapped_product_id,variant_id, product:products(id,name,sku), variant:variants(id,sku,color)").eq("purchase_id", id),
    sb.from("stock_adjustments").select("product_id,variant_id,delta").eq("ref_id", id).eq("kind", "purchase_return"),
  ]);
  if (error) return { ok: false, error: error.message };
  const retBy = new Map<string, number>();
  for (const r of ((rets as any[]) ?? [])) {
    const k = `${r.product_id}::${r.variant_id ?? ""}`;
    retBy.set(k, (retBy.get(k) ?? 0) + Math.abs(r.delta ?? 0));
  }
  return { ok: true, items: ((items as any[]) ?? []).filter((it) => it.mapped_product_id).map((it) => {
    const returned = retBy.get(`${it.mapped_product_id}::${it.variant_id ?? ""}`) ?? 0;
    return {
      productId: it.mapped_product_id, variantId: it.variant_id ?? null,
      name: it.product?.name ?? "—", sku: it.variant?.sku ?? it.product?.sku ?? "",
      color: it.variant?.color ?? null,
      qty: it.qty ?? 0, returned, returnable: Math.max(0, (it.qty ?? 0) - returned),
      unitCost: it.unit_cost ?? 0,
    };
  }) };
}

/** Record a PURCHASE RETURN (goods back to the supplier): variant-exact stock out + debit note.
 *  The RPC enforces the per-line cap (bought − already returned) — same rule as sales returns. */
export async function recordPurchaseReturnAction(input: { purchaseId: string; reason: string; items: { productId: string; variantId?: string | null; qty: number }[] }): Promise<{ ok: boolean; qty?: number; amount?: number; error?: string }> {
  if (!(await requirePerm("purchases.manage"))) return { ok: false, error: "Your role can't manage purchases." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Add a reason (damaged, wrong goods, excess…)" };
  const sb = supabaseServer();
  const p_items = input.items.map((i) => ({ product_id: i.productId, variant_id: i.variantId ?? null, qty: i.qty }));
  const { data, error } = await sb.rpc("record_purchase_return", { p_purchase_id: input.purchaseId, p_reason: input.reason, p_items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/purchases"); revalidatePath(`/admin/purchase/${input.purchaseId}`); revalidatePath("/admin/returns"); revalidatePath("/admin/stock-movements");
  return { ok: true, qty: (data as any)?.qty, amount: (data as any)?.amount };
}
