"use server";
/** Owner housekeeping for the Abandoned Carts list — remove rows that aren't worth chasing. */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/** Delete ONE abandoned-cart row (owner decides it's irrelevant — anonymous, tiny, spammy, etc.). */
export async function deleteAbandonedCartAction(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "not permitted" };
  const clean = String(id ?? "").trim();
  if (!clean) return { ok: false, error: "Missing cart id." };
  const { error } = await supabaseServer().from("abandoned_carts").delete().eq("id", clean);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/abandoned");
  return { ok: true };
}

/** Clear ALL anonymous carts with no phone number in one go — the ones the owner can never act on. */
export async function clearAnonymousCartsAction(): Promise<{ ok: boolean; removed?: number; error?: string }> {
  if (!(await requirePerm("marketing.manage"))) return { ok: false, error: "not permitted" };
  const sb = supabaseServer();
  // No phone AND not recovered = a dead lead. Keep anything with a contact number or already recovered.
  const { data, error } = await sb.from("abandoned_carts")
    .delete()
    .or("phone.is.null,phone.eq.")
    .neq("recovered", true)
    .select("id");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/abandoned");
  return { ok: true, removed: ((data as any[]) ?? []).length };
}
