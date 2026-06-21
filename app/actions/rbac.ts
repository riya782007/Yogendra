"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

export const PERMISSIONS = ["product_editing", "inventory", "billing", "purchases", "analytics", "user_management", "approvals"] as const;

export async function createRoleAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const permissions = PERMISSIONS.filter((p) => formData.get(`perm_${p}`) === "on");
  await supabaseServer().from("roles").insert({ name, permissions });
  revalidatePath("/admin/roles");
}
