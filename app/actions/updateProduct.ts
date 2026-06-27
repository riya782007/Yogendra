"use server";
/**
 * updateProductAction — full edit of an existing product from the owner console.
 * Updates core columns (name, category, type, status, base price, qty) AND the
 * generated_content JSON (title, description, tags, SEO meta + keywords, specs).
 * Money stays in integer paise; the pricing formula re-derives retail/MRP/wholesale.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { computePrices, isValidPriceSet } from "@/lib/pricing";
import { getPricingFormula } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";

/** newline- or comma-separated → clean string[] */
function parseList(raw: string): string[] {
  return String(raw ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "Key: Value" per line → { Key: Value } (order preserved) */
function parseSpecs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of String(raw ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

export type UpdateResult = { ok: boolean; error?: string };

export async function updateProductAction(formData: FormData): Promise<UpdateResult> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "Your role can't edit products." };
  const sku = String(formData.get("sku") ?? "").trim();
  if (!sku) return { ok: false, error: "Missing SKU" };

  const sb = supabaseServer();
  const { data: existing } = await sb
    .from("products")
    .select("id, generated_content")
    .eq("sku", sku)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Product not found" };

  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const type = String(formData.get("type") ?? "simple");
  const status = String(formData.get("status") ?? "published");
  const basePriceRupees = Number(formData.get("base_price_rupees") ?? 0);
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));

  if (!name) return { ok: false, error: "Name is required" };
  if (!categoryId) return { ok: false, error: "Category is required" };
  if (!(basePriceRupees > 0)) return { ok: false, error: "Base price must be greater than 0" };

  // Re-validate the resulting price set against the formula.
  const formula = await getPricingFormula();
  const prices = computePrices(Math.round(basePriceRupees * 100), formula);
  if (!isValidPriceSet(prices)) return { ok: false, error: "That base price produces an invalid price set — adjust it." };

  // Merge content (keep anything we don't expose in the form).
  const prev = (existing.generated_content as any) ?? {};
  const generated_content = {
    ...prev,
    title: String(formData.get("title") ?? "").trim() || name,
    description: String(formData.get("description") ?? "").trim(),
    tags: parseList(String(formData.get("tags") ?? "")),
    specs: parseSpecs(String(formData.get("specs") ?? "")),
    seo: {
      ...(prev.seo ?? {}),
      metaTitle: String(formData.get("meta_title") ?? "").trim(),
      metaDescription: String(formData.get("meta_description") ?? "").trim(),
      keywords: parseList(String(formData.get("keywords") ?? "")),
    },
  };

  const { error } = await sb
    .from("products")
    .update({
      name,
      category_id: categoryId,
      type,
      status,
      // Schema note: visibility is stored as the `wholesale_only` boolean (main's design).
      // The form still sends "visibility=wholesale|all" so existing UI doesn't change.
      wholesale_only: String(formData.get("visibility") ?? "all") === "wholesale",
      base_wholesale: Math.round(basePriceRupees * 100),
      qty,
      generated_content,
      last_movement_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) return { ok: false, error: error.message };

  // Labels are stored in a separate `labels` table joined via `product_labels`. The form
  // submits a comma/newline list of names; we (a) upsert each name into labels so unknown
  // names get auto-created, then (b) re-sync the product_labels rows for this product.
  const labelNames = parseList(String(formData.get("labels") ?? ""));
  if (labelNames.length) {
    await sb.from("labels").upsert(
      labelNames.map((name) => ({ name, color: "emerald" })),
      { onConflict: "name", ignoreDuplicates: true },
    );
  }
  const { data: labelRows } = await sb.from("labels").select("id,name").in("name", labelNames.length ? labelNames : ["__none__"]);
  const wantIds = new Set(((labelRows as any[]) ?? []).map((r) => r.id));
  // Replace the join set: delete the rows we no longer want, insert the new ones.
  const { data: existingJoin } = await sb.from("product_labels").select("label_id").eq("product_id", existing.id);
  const haveIds = new Set(((existingJoin as any[]) ?? []).map((r) => r.label_id));
  const toAdd = [...wantIds].filter((id) => !haveIds.has(id));
  const toRemove = [...haveIds].filter((id) => !wantIds.has(id));
  if (toRemove.length) await sb.from("product_labels").delete().eq("product_id", existing.id).in("label_id", toRemove);
  if (toAdd.length) {
    await sb.from("product_labels").upsert(
      toAdd.map((labelId) => ({ product_id: existing.id, label_id: labelId })),
      { onConflict: "product_id,label_id", ignoreDuplicates: true },
    );
  }

  // Optional: rename the SKU (the client asked for editable SKUs). Validate uniqueness
  // first so we never create a duplicate. FK references use product_id, so this is safe.
  let finalSku = sku;
  const newSku = String(formData.get("new_sku") ?? "").trim().toUpperCase().replace(/\s+/g, "-");
  if (newSku && newSku !== sku.toUpperCase()) {
    const { data: dup } = await sb.from("products").select("id").eq("sku", newSku).maybeSingle();
    if (dup) return { ok: false, error: `SKU ${newSku} already exists — choose a different one.` };
    const { error: skuErr } = await sb.from("products").update({ sku: newSku }).eq("id", existing.id);
    if (skuErr) return { ok: false, error: skuErr.message };
    finalSku = newSku;
  }

  // Revalidate everywhere this product appears.
  const { data: cat } = await sb.from("categories").select("slug").eq("id", categoryId).maybeSingle();
  const slug = (cat as any)?.slug ?? "all";
  revalidatePath(`/shop/${slug}/${finalSku}`);
  revalidatePath(`/shop/${slug}/${sku}`);
  revalidatePath(`/shop/c/${slug}`);
  revalidatePath("/shop");
  revalidatePath("/catalog");
  revalidatePath("/wholesale");
  revalidatePath("/admin/catalogue");
  revalidatePath("/admin/media");
  return { ok: true };
}
