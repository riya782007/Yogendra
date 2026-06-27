"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const KINDS = ["color", "size", "polish"] as const;
const col = (kind: string) => (kind === "color" ? "color" : kind === "size" ? "size" : "polish");

/** Add a colour / size / polish to the master list (Pillar 7). */
export async function addOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  const value = String(formData.get("value") ?? "").trim();
  const hex = String(formData.get("hex") ?? "").trim() || null;
  if (!value) return;
  await supabaseServer().from("variant_options").upsert({ kind, value, hex }, { onConflict: "kind,value", ignoreDuplicates: false });
  revalidatePath("/admin/colours");
}

/** Rename (with cascade to every variant using it) and/or set the swatch of an option. */
export async function updateOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  const oldValue = String(formData.get("old_value") ?? "");
  const newValue = String(formData.get("value") ?? "").trim() || oldValue;
  const hex = String(formData.get("hex") ?? "").trim() || null;
  if (!oldValue) return;
  const sb = supabaseServer();
  await sb.from("variant_options").update({ value: newValue, hex }).eq("kind", kind).eq("value", oldValue);
  if (newValue !== oldValue) {
    // Cascade the rename to every variant carrying the old value, so the catalogue stays consistent.
    await sb.from("variants").update({ [col(kind)]: newValue }).eq(col(kind), oldValue);
  }
  revalidatePath("/admin/colours");
}

/** Remove an option from the master list AND null it out on every variant that still
 *  carries the now-defunct value — so we don't leave orphan strings on variants that no
 *  longer appear in the autocomplete pool (Pillar 7 sanity). The product itself is kept; if
 *  the variant ends up with no attributes at all it becomes a plain "VAR" variant and the
 *  owner can re-attribute it or delete it from the catalogue page. */
export async function deleteOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  // Prefer the original value so editing the name then clicking Delete still removes the right row.
  const value = String(formData.get("old_value") || formData.get("value") || "");
  if (!value) return;
  const sb = supabaseServer();
  await sb.from("variant_options").delete().eq("kind", kind).eq("value", value);
  // Cascade: clear the corresponding column on every variant currently using this value.
  await sb.from("variants").update({ [col(kind)]: null }).eq(col(kind), value);
  revalidatePath("/admin/colours");
  // Variant attribute counts and product types may need to flip — revalidate the catalogue too.
  revalidatePath("/admin/catalogue");
}
