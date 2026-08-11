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

/** Pillar 14: record a payment made TO a supplier (reduces what we owe). Records the SPECIFIC account the
 *  money left (Cash / UPI / Kotak / SBI / HDFC) so that account's Bank & Cash balance drops — the same way
 *  the purchase-entry and receive-payment flows work (owner: "banks ke naam nahi aa rahe"). */
export async function recordSupplierPaymentAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("suppliers.manage"))) return;
  const id = String(formData.get("id") ?? "");
  const rupees = Number(formData.get("amount") ?? 0);
  const methodId = String(formData.get("method_id") ?? "").trim() || null;
  const ref = String(formData.get("ref") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!id || !Number.isFinite(rupees) || rupees <= 0) return;
  const sb = supabaseServer();
  const paise = Math.round(rupees * 100);

  // Resolve the chosen account → the coarse mode the supplier ledger stores, and its display name.
  let mode = ["cash", "bank", "upi"].includes(String(formData.get("mode"))) ? String(formData.get("mode")) : "bank";
  let acctName: string | null = null;
  if (methodId) {
    const { data: m } = await sb.from("payment_methods").select("name,kind").eq("id", methodId).maybeSingle();
    if (m) {
      acctName = (m as any).name;
      mode = String((m as any).kind).toLowerCase() === "cash" ? "cash" : /upi/i.test((m as any).name) ? "upi" : "bank";
    }
  }

  // Record the payment (with the specific account when available; retry without method_id on an older DB).
  const res = await sb.from("supplier_payments").insert({ supplier_id: id, amount: paise, mode, method_id: methodId, ref, note });
  if (res.error) await sb.from("supplier_payments").insert({ supplier_id: id, amount: paise, mode, ref, note }).then(() => {}, () => {});

  // Money LEAVES the named account → its Bank & Cash balance drops (mirrors purchase entry).
  if (methodId) {
    await sb.from("payment_method_transactions").insert({
      method_id: methodId, txn_type: "purchase", direction: "out", amount: paise,
      ref_type: "supplier", ref_id: id, note: acctName ? `Paid supplier via ${acctName}` : "Supplier payment",
      created_by: "owner", occurred_at: new Date().toISOString(),
    }).then(() => {}, () => {});
  }
  revalidatePath(`/admin/supplier/${id}`); revalidatePath("/admin/cashbook");
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
