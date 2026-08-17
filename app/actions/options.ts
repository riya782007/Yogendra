"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";
import { COLOR_CATALOG, snapColorName, isRedundantColorOption, canonicalColorName, barcodeCodeForColor, buildVariantSku } from "@/lib/colors";

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
  const raw = String(formData.get("value") ?? "").trim();
  const hex = String(formData.get("hex") ?? "").trim() || null;
  if (!raw) return;
  const value = kind === "color" ? snapColorName(raw) : raw;
  const patch: Record<string, any> = { kind, value, hex };
  if (kind === "color") patch.barcode_code = normaliseCode(formData.get("barcode_code")) || barcodeCodeForColor(value);
  await supabaseServer().from("variant_options").upsert(patch, { onConflict: "kind,value", ignoreDuplicates: false });
  revalidatePath("/admin/colours");
}

/** Rename (with cascade to every variant using it) and/or set the swatch / barcode_code. */
export async function updateOptionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("catalog.edit"))) return;
  const kind = String(formData.get("kind") ?? "color");
  if (!KINDS.includes(kind as any)) return;
  const oldValue = String(formData.get("old_value") ?? "");
  const newValue = kind === "color"
    ? snapColorName(String(formData.get("value") ?? "").trim() || oldValue)
    : (String(formData.get("value") ?? "").trim() || oldValue);
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

async function pageAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const step = 1000; const out: T[] = [];
  for (let from = 0; ; from += step) {
    const { data } = await build(from, from + step - 1);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < step) break;
  }
  return out;
}

async function retarget(sb: ReturnType<typeof supabaseServer>, table: string, fromId: string, toId: string) {
  await (sb.from(table) as any).update({ variant_id: toId }).eq("variant_id", fromId).then(() => {}, () => {});
}

/**
 * Collapse misspelled / case-duplicate colours onto the 75-name catalog: remap every variant,
 * merge two colours of the same design that become the same colour, then delete the extra
 * master-list rows (SILVAR, silver, Silver2, …).
 */
export async function cleanupDuplicateColoursAction(): Promise<{
  remapped: number; merged: number; deletedOptions: number; error?: string;
}> {
  if (!(await requirePerm("catalog.edit"))) return { remapped: 0, merged: 0, deletedOptions: 0, error: "not permitted" };
  const sb = supabaseServer();
  const variants = await pageAll((f, t) =>
    sb.from("variants").select("id,product_id,sku,color,size,polish,qty,image_paths").range(f, t),
  );

  let remapped = 0;
  const groups = new Map<string, any[]>();
  for (const v of variants) {
    const raw = String(v.color ?? "").trim();
    const color = raw ? snapColorName(raw) : "";
    if (raw && color !== raw) remapped++;
    const key = `${v.product_id}::${color.toLowerCase()}::${String(v.size ?? "").toLowerCase()}::${String(v.polish ?? "").toLowerCase()}`;
    const row = { ...v, color: color || null, raw };
    const g = groups.get(key) ?? [];
    g.push(row);
    groups.set(key, g);
  }

  let merged = 0;
  const productQty = new Set<string>();
  for (const [, g] of groups) {
    const canon = g[0].color as string | null;
    const dirty = g.length > 1 || g.some((x) => (x.raw || "") !== (x.color || ""));
    if (!dirty) continue;
    const code = (canon && barcodeCodeForColor(canon)) || "";
    const winner = [...g].sort((a, b) => {
      const as = code && String(a.sku ?? "").toUpperCase().includes(code) ? 1 : 0;
      const bs = code && String(b.sku ?? "").toUpperCase().includes(code) ? 1 : 0;
      if (bs !== as) return bs - as;
      return (b.qty ?? 0) - (a.qty ?? 0);
    })[0];
    const wantSku = canon
      ? buildVariantSku(String(winner.sku ?? "").split("-")[0] || "X", { color: canon, size: winner.size, polish: winner.polish })
      : winner.sku;

    const losers = g.filter((x) => x.id !== winner.id);
    const qty = g.reduce((s, x) => s + (Number(x.qty) || 0), 0);
    const images = [...new Set(g.flatMap((x) => ((x.image_paths as string[]) ?? [])))];
    const patch: any = { color: canon, qty, image_paths: images };
    if (wantSku && wantSku !== winner.sku) {
      const { data: clash } = await sb.from("variants").select("id").ilike("sku", wantSku).maybeSingle();
      if (!clash || (clash as any).id === winner.id) patch.sku = wantSku;
    }
    await sb.from("variants").update(patch).eq("id", winner.id);
    productQty.add(winner.product_id);

    for (const loser of losers) {
      merged++;
      await retarget(sb, "order_items", loser.id, winner.id);
      await retarget(sb, "estimate_items", loser.id, winner.id);
      await retarget(sb, "stock_adjustments", loser.id, winner.id);
      await retarget(sb, "purchase_items", loser.id, winner.id);
      await (sb.from("products") as any).update({ default_variant_id: winner.id }).eq("default_variant_id", loser.id).then(() => {}, () => {});
      await (sb.from("variant_channel_settings") as any).delete().eq("variant_id", loser.id).then(() => {}, () => {});
      await (sb.from("product_images") as any).update({ variant_id: winner.id }).eq("variant_id", loser.id).then(() => {}, () => {});
      await sb.from("variants").delete().eq("id", loser.id);
    }
  }

  for (const pid of productQty) {
    const { data: vs } = await sb.from("variants").select("qty").eq("product_id", pid);
    const total = ((vs as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    await sb.from("products").update({ qty: total }).eq("id", pid);
  }

  const { data: opts } = await sb.from("variant_options").select("value").eq("kind", "color");
  let deletedOptions = 0;
  for (const r of ((opts as any[]) ?? [])) {
    const v = String(r.value ?? "");
    if (!isRedundantColorOption(v) && !canonicalColorName(v)) continue;
    if (isRedundantColorOption(v) || (canonicalColorName(v) && canonicalColorName(v) !== v.trim())) {
      await sb.from("variant_options").delete().eq("kind", "color").eq("value", v);
      deletedOptions++;
    }
  }

  revalidatePath("/admin/colours");
  revalidatePath("/admin/catalogue");
  revalidatePath("/shop");
  return { remapped, merged, deletedOptions };
}
