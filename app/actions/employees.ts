"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/** Add or edit an employee (salesperson). Gated to customer/staff managers. */
export async function upsertEmployeeAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const row = {
    name,
    phone: String(formData.get("phone") ?? "").trim() || null,
    title: String(formData.get("title") ?? "").trim() || null,
    active: String(formData.get("active") ?? "on") !== "off",
  };
  const sb = supabaseServer();
  if (id) await sb.from("employees").update(row).eq("id", id);
  else await sb.from("employees").insert(row);
  revalidatePath("/admin/employees");
}

/** Toggle an employee active/inactive (kept, not deleted, so their past sales stay attributed). */
export async function setEmployeeActiveAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "true";
  if (!id) return;
  await supabaseServer().from("employees").update({ active }).eq("id", id);
  revalidatePath("/admin/employees");
}
