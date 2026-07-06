"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

export async function upsertCustomerAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const creditRupees = Number(formData.get("credit_balance") ?? 0) || 0;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const row = {
    name,
    phone,
    email: String(formData.get("email") ?? "").trim() || null,
    type: String(formData.get("type") ?? "retail") === "wholesale" ? "wholesale" : "retail",
    gstin: String(formData.get("gstin") ?? "").trim() || null,
    address: String(formData.get("address") ?? "").trim() || null,
    city: String(formData.get("city") ?? "").trim() || null,
    credit_balance: Math.round(creditRupees * 100),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  const sb = supabaseServer();

  // De-duplication: when creating a NEW customer (no id given), match an existing record
  // by phone first (strongest signal), falling back to a case-insensitive exact name match.
  // This stops "Priya" entered twice (or with different casing/whitespace) from splitting
  // one customer's order history across two rows.
  let targetId = id;
  if (!targetId) {
    let existing: { id: string } | null = null;
    if (phone) {
      const { data } = await sb.from("customers").select("id").eq("phone", phone).maybeSingle();
      existing = (data as any) ?? null;
    }
    if (!existing && name) {
      const { data } = await sb.from("customers").select("id").ilike("name", name).maybeSingle();
      existing = (data as any) ?? null;
    }
    if (existing) targetId = existing.id;
  }

  if (targetId) await sb.from("customers").update(row).eq("id", targetId);
  else await sb.from("customers").insert(row);
  revalidatePath("/admin/customers");
  if (targetId) revalidatePath(`/admin/customer/${targetId}`);
}

export async function deleteCustomerAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().from("customers").delete().eq("id", id);
  revalidatePath("/admin/customers");
  redirect("/admin/customers");
}
