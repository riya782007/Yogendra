"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/** Pillar 13: set the opening balance we owed this supplier when tracking began (₹ → paise). */
export async function setSupplierOpeningBalanceAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("suppliers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const rupees = Number(formData.get("opening") ?? 0);
  if (!id || !Number.isFinite(rupees) || rupees < 0) return;
  await supabaseServer().from("suppliers").update({ opening_balance: Math.round(rupees * 100) }).eq("id", id);
  revalidatePath(`/admin/supplier/${id}`);
}

/** Pillar 14: record a payment made TO a supplier (reduces what we owe). */
export async function recordSupplierPaymentAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("suppliers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const rupees = Number(formData.get("amount") ?? 0);
  const mode = ["cash", "bank", "upi"].includes(String(formData.get("mode"))) ? String(formData.get("mode")) : "cash";
  const ref = String(formData.get("ref") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !Number.isFinite(rupees) || rupees <= 0) return;
  await supabaseServer().from("supplier_payments").insert({ supplier_id: id, amount: Math.round(rupees * 100), mode, ref, note });
  revalidatePath(`/admin/supplier/${id}`);
}

/** Delete a supplier payment (correction). */
export async function deleteSupplierPaymentAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("suppliers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const supplierId = String(formData.get("supplier_id") ?? "");
  if (!id) return;
  await supabaseServer().from("supplier_payments").delete().eq("id", id);
  revalidatePath(`/admin/supplier/${supplierId}`);
}

export async function upsertSupplierAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("suppliers.manage"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const row = {
    name,
    kind: String(formData.get("kind") ?? "supplier"),
    city: String(formData.get("city") ?? "").trim() || null,
    state: String(formData.get("state") ?? "").trim() || null,
    phone: String(formData.get("phone") ?? "").trim() || null,
    gstin: String(formData.get("gstin") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  const sb = supabaseServer();
  if (id) await sb.from("suppliers").update(row).eq("id", id);
  else await sb.from("suppliers").insert(row);
  revalidatePath("/admin/suppliers"); revalidatePath("/admin/purchases");
}

export async function deleteSupplierAction(formData: FormData) {
  if (!(await requirePerm("suppliers.manage"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("suppliers").delete().eq("id", id);
  revalidatePath("/admin/suppliers");
}
