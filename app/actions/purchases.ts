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

export async function recordPurchaseAction(input: { supplierId: string; billNo: string; items: PurchaseLine[] }): Promise<{ ok: boolean; total?: number; error?: string }> {
  if (!input.supplierId) return { ok: false, error: "Choose a supplier" };
  const items = (input.items ?? []).filter((l) => l.qty > 0 && l.unitCostRupees > 0);
  if (!items.length) return { ok: false, error: "Add at least one line with qty and cost" };
  const payload = items.map((l) => ({ supplier_sku: l.supplierSku, mapped_product_id: l.mappedProductId || "", variant_id: l.variantId || "", qty: l.qty, unit_cost: Math.round(l.unitCostRupees * 100) }));
  const { data, error } = await supabaseServer().rpc("record_purchase", { p_supplier_id: input.supplierId, p_bill_no: input.billNo || null, p_items: payload });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/purchases"); revalidatePath("/admin/dashboard");
  return { ok: true, total: (data as any)?.total };
}
