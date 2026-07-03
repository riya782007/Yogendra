"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

/** Internal, admin-only per-product status tags (e.g. "inventory updated", "variant images sorted").
 *  Never shown on the storefront. */
async function loadTags(sku: string): Promise<{ id: string; tags: string[] } | null> {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("id,admin_tags").ilike("sku", sku).maybeSingle();
  if (!data) return null;
  return { id: (data as any).id, tags: (((data as any).admin_tags as string[]) ?? []) };
}

export async function addProductTagAction(sku: string, tag: string): Promise<{ ok: boolean; tags?: string[]; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "Your role can't edit the catalogue." };
  const clean = (tag ?? "").trim().slice(0, 40);
  if (!clean) return { ok: false, error: "Empty tag." };
  const cur = await loadTags(sku);
  if (!cur) return { ok: false, error: "Product not found." };
  // Case-insensitive de-dupe so the same note isn't added twice.
  if (cur.tags.some((t) => t.toLowerCase() === clean.toLowerCase())) return { ok: true, tags: cur.tags };
  const next = [...cur.tags, clean];
  await supabaseServer().from("products").update({ admin_tags: next }).eq("id", cur.id);
  revalidatePath("/admin/catalogue");
  revalidatePath(`/admin/product/${sku}`);
  revalidatePath(`/admin/catalogue/${sku}`);
  return { ok: true, tags: next };
}

export async function removeProductTagAction(sku: string, tag: string): Promise<{ ok: boolean; tags?: string[]; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "Your role can't edit the catalogue." };
  const cur = await loadTags(sku);
  if (!cur) return { ok: false, error: "Product not found." };
  const next = cur.tags.filter((t) => t !== tag);
  await supabaseServer().from("products").update({ admin_tags: next }).eq("id", cur.id);
  revalidatePath("/admin/catalogue");
  revalidatePath(`/admin/product/${sku}`);
  revalidatePath(`/admin/catalogue/${sku}`);
  return { ok: true, tags: next };
}
