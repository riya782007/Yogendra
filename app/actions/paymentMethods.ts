"use server";
/**
 * Master Payment Methods — the single source of truth (Phase 1).
 * Managed once on the Bank & Payment Methods page; every billing screen reads this list.
 * All money values are handled in integer paise.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { logActivity } from "@/lib/audit";

const KINDS = ["cash", "bank", "upi", "wallet", "card", "cheque", "razorpay", "other"];
const rupeesToPaise = (v: FormDataEntryValue | null) => Math.round((Number(v ?? 0) || 0) * 100);
const str = (v: FormDataEntryValue | null) => String(v ?? "").trim() || null;

function refresh() {
  revalidatePath("/admin/cashbook");
  revalidatePath("/admin/billing");
}

/** Build the editable column set from a submitted form (used by add + update). */
function fieldsFromForm(formData: FormData) {
  const kindRaw = String(formData.get("kind") ?? "bank").toLowerCase();
  return {
    name: String(formData.get("name") ?? "").trim(),
    kind: KINDS.includes(kindRaw) ? kindRaw : "bank",
    bank_name: str(formData.get("bank_name")),
    account_name: str(formData.get("account_name")),
    account_number: str(formData.get("account_number")),
    upi_id: str(formData.get("upi_id")),
    qr_code_url: str(formData.get("qr_code_url")),
    branch: str(formData.get("branch")),
    color: str(formData.get("color")),
    icon: str(formData.get("icon")),
    notes: str(formData.get("notes")),
  };
}

export async function addPaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.create"))) return;
  const f = fieldsFromForm(formData);
  if (!f.name) return;
  const sb = supabaseServer();
  // New methods go to the end of the display order.
  const { data: last } = await sb.from("payment_methods").select("sort").order("sort", { ascending: false }).limit(1).maybeSingle();
  const sort = ((last as any)?.sort ?? 0) + 1;
  await sb.from("payment_methods").insert({
    ...f,
    opening_balance: rupeesToPaise(formData.get("opening_balance")),
    sort,
    active: true,
    archived: false,
    created_by: "owner",
  });
  await logActivity({ action: "payment_method_created", ref: f.name, detail: `${f.name} (${f.kind})` });
  refresh();
}

export async function updatePaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const f = fieldsFromForm(formData);
  if (!id || !f.name) return;
  // Opening balance is gated by a stricter permission; only update it when allowed + provided.
  const patch: Record<string, any> = { ...f };
  if (formData.get("opening_balance") != null && (await requirePerm("payments.opening"))) {
    patch.opening_balance = rupeesToPaise(formData.get("opening_balance"));
  }
  await supabaseServer().from("payment_methods").update(patch).eq("id", id);
  await logActivity({ action: "payment_method_edited", ref: f.name, detail: `Edited ${f.name}` });
  refresh();
}

export async function setPaymentMethodActiveAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const active = String(formData.get("active") ?? "") === "1";
  if (!id) return;
  await supabaseServer().from("payment_methods").update({ active }).eq("id", id);
  await logActivity({ action: active ? "payment_method_enabled" : "payment_method_disabled", ref: id });
  refresh();
}

export async function archivePaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const archived = String(formData.get("archived") ?? "1") === "1";
  if (!id) return;
  // Archiving also deactivates so it leaves every billing screen immediately.
  await supabaseServer().from("payment_methods").update({ archived, active: archived ? false : true }).eq("id", id);
  await logActivity({ action: archived ? "payment_method_archived" : "payment_method_unarchived", ref: id });
  refresh();
}

/** Delete is allowed ONLY for a method with no ledger history — otherwise we must preserve the
 *  historical record, so the caller should archive instead. */
export async function deletePaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.delete"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  // Preserve history: only a method with no ledger rows may be deleted; otherwise archive instead.
  const { count } = await sb.from("payment_method_transactions").select("id", { count: "exact", head: true }).eq("method_id", id);
  if ((count ?? 0) > 0) { await archivePaymentMethodAction(formData); return; }
  await sb.from("payment_methods").delete().eq("id", id);
  await logActivity({ action: "payment_method_deleted", ref: id });
  refresh();
}

/** Reorder by swapping the display order with the adjacent method. */
export async function reorderPaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  const dir = String(formData.get("dir") ?? "");
  if (!id || !["up", "down"].includes(dir)) return;
  const sb = supabaseServer();
  const { data: all } = await sb.from("payment_methods").select("id,sort").order("sort").order("name");
  const list = (all as any[]) ?? [];
  const i = list.findIndex((m) => m.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  await Promise.all([
    sb.from("payment_methods").update({ sort: b.sort }).eq("id", a.id),
    sb.from("payment_methods").update({ sort: a.sort }).eq("id", b.id),
  ]);
  refresh();
}

export async function setDefaultPaymentMethodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.edit"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  await sb.from("payment_methods").update({ is_default: false }).neq("id", id);
  await sb.from("payment_methods").update({ is_default: true }).eq("id", id);
  await logActivity({ action: "payment_method_default_set", ref: id });
  refresh();
}

export async function setOpeningBalanceAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("payments.opening"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await supabaseServer().from("payment_methods").update({ opening_balance: rupeesToPaise(formData.get("opening_balance")) }).eq("id", id);
  await logActivity({ action: "payment_method_opening_changed", ref: id });
  refresh();
}
