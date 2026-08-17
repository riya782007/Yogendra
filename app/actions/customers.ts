"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { ensureDirectoryCustomer } from "@/lib/supabase/queries";

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
    targetId = (await ensureDirectoryCustomer(sb, { name, phone, gstin: row.gstin, address: row.address, type: row.type })) ?? "";
  }
  if (targetId) await sb.from("customers").update(row).eq("id", targetId);
  else await sb.from("customers").insert(row);
  // Bust the cached customer list so a NEW customer shows up IMMEDIATELY in the estimate builder and POS
  // (both read getCustomersDbCached, tagged "customers"). Without this the new customer stayed invisible
  // for up to 30s — owner: "customer banaya, estimate me nahi aa raha."
  revalidateTag("customers");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/estimates");
  revalidatePath("/admin/billing");
  if (targetId) revalidatePath(`/admin/customer/${targetId}`);
}

export async function deleteCustomerAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  // Orders reference the customer with a BLOCKING foreign key, so a customer who had any past order
  // could never be deleted — the delete failed silently and nothing happened (owner: "delete ho nahi
  // raha"). Detach those orders first: clear the customer link but KEEP the order and its customer_name,
  // so the sales history stays intact. Then the customer row deletes cleanly.
  await sb.from("orders").update({ customer_id: null }).eq("customer_id", id);
  const { error } = await sb.from("customers").delete().eq("id", id);
  if (error) {
    revalidatePath("/admin/customers");
    redirect(`/admin/customers?delerror=${encodeURIComponent(error.message)}`);
  }
  revalidateTag("customers");
  revalidatePath("/admin/customers");
  redirect("/admin/customers");
}

/** Merge customers that share the same name into one (keeps a wholesale record / the one with most
 *  orders / the oldest, re-points every order onto it, deletes the extras). Pass "name" to scope to one
 *  name (e.g. Myntra), or leave blank to clean every duplicate-name group. Cleans up the duplicates that
 *  marketplace automations create per order. */
export async function mergeDuplicateCustomersAction(formData: FormData) {
  if (!(await requirePerm("customers.manage"))) return;
  const name = String(formData.get("name") ?? "").trim() || null;
  const { data } = await supabaseServer().rpc("merge_duplicate_customers", { p_name: name });
  revalidateTag("customers");
  revalidatePath("/admin/customers");
  redirect(`/admin/customers?merged=${(data as any)?.removed ?? 0}`);
}
