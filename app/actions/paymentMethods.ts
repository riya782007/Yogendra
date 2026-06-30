"use server";
/** Owner-managed bank / payment methods (Meeting 2 §1). Added once, picked at billing. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

export async function addPaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("analytics.view"))) return;
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "bank");
  if (!name) return;
  await supabaseServer().from("payment_methods").insert({ name, kind: ["bank", "upi", "wallet"].includes(kind) ? kind : "bank" });
  revalidatePath("/admin/cashbook"); revalidatePath("/admin/billing");
}

export async function deletePaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("analytics.view"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await supabaseServer().from("payment_methods").delete().eq("id", id);
  revalidatePath("/admin/cashbook"); revalidatePath("/admin/billing");
}
