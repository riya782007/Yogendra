"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { COLOR_CATALOG } from "@/lib/colors";

const KINDS = ["color", "size", "polish"] as const;
const col = (kind: string) => (kind === "color" ? "color" : kind === "size" ? "size" : "polish");

/** Normalise a user-typed barcode code: uppercase, alphanumeric only, max 12 chars.
 *  Empty string becomes null (= "use the fallback derived from the colour name"). */
function normaliseCode(raw: FormDataEntryValue | null): string | null {
  const s = String(raw ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return s || null;
}

/** Add a colour / size / polish to the master list (Pillar 7). For colours, an optional
 *  barcode_code is captured — this is the short suffix (RED, MULTI1, SBLUE…) that prints
 *  on the variant's barcode label and forms the auto-generated variant SKU. */
export async function addOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  const value = String(formData.get("value") ?? "").trim();
  const hex = String(formData.get("hex") ?? "").trim() || null;
  if (!value) return;
  const patch: Record<string, any> = { kind, value, hex };
  if (kind === "color") patch.barcode_code = normaliseCode(formData.get("barcode_code"));
  await supabaseServer().from("variant_options").upsert(patch, { onConflict: "kind,value", ignoreDuplicates: false });
  revalidatePath("/admin/colours");
}

/** Rename (with cascade to every variant using it) and/or set the swatch / barcode_code. */
export async function updateOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  const oldValue = String(formData.get("old_value") ?? "");
  const newValue = String(formData.get("value") ?? "").trim() || oldValue;
  const hex = String(formData.get("hex") ?? "").trim() || null;
  if (!oldValue) return;
  const sb = supabaseServer();
  const patch: Record<string, any> = { value: newValue, hex };
  if (kind === "color") patch.barcode_code = normaliseCode(formData.get("barcode_code"));
  await sb.from("variant_options").update(patch).eq("kind", kind).eq("value", oldValue);
  if (newValue !== oldValue) {
    // Cascade the rename to every variant carrying the old value, so the catalogue stays consistent.
    await sb.from("variants").update({ [col(kind)]: newValue }).eq(col(kind), oldValue);
  }
  revalidatePath("/admin/colours");
}

/** Remove an option from the master list AND null it out on every variant that still
 *  carries the now-defunct value (Pillar 7 sanity). */
export async function deleteOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  const value = String(formData.get("old_value") || formData.get("value") || "");
  if (!value) return;
  const sb = supabaseServer();
  await sb.from("variant_options").delete().eq("kind", kind).eq("value", value);
  await sb.from("variants").update({ [col(kind)]: null }).eq(col(kind), value);
  revalidatePath("/admin/colours");
  revalidatePath("/admin/catalogue");
}

/** Pillar 7 — one-shot seed action that pours the canonical 75-colour catalog into
 *  variant_options. Idempotent (matches migration 0016): existing rows have their
 *  barcode_code and sort refreshed; their `hex` swatch is preserved. Safe to re-run
 *  from the Colours page whenever the master needs to be re-aligned to canonical. */
export async function seedDefaultColoursAction(): Promise<{ created: number; updated: number }> {
  if (!(await requirePerm("catalog.edit"))) return { created: 0, updated: 0 };
  const sb = supabaseServer();
  const rows = COLOR_CATALOG.map((c) => ({
    kind: "color" as const,
    value: c.name,
    barcode_code: c.code,
    sort: c.sort,
  }));
  // Find which names already exist so we can report created vs updated counts.
  const { data: existing } = await sb.from("variant_options").select("value").eq("kind", "color").in("value", rows.map((r) => r.value));
  const have = new Set(((existing as any[]) ?? []).map((r) => String(r.value).toLowerCase()));
  const created = rows.filter((r) => !have.has(r.value.toLowerCase())).length;
  await sb.from("variant_options").upsert(rows, { onConflict: "kind,value", ignoreDuplicates: false });
  revalidatePath("/admin/colours");
  return { created, updated: rows.length - created };
}
