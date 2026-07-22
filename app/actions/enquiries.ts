"use server";
/**
 * "Show me the rest of the designs" pipeline.
 *
 * Some designs run to 20–30 colourways — far more than the wholesale panel can usefully list. The owner
 * flags those products; the dealer panel then invites the dealer to see the full range in the store or
 * over a video call. Every tap is recorded here so a serious dealer's interest is never lost inside a
 * WhatsApp thread — the owner works them off a dashboard, exactly like wholesale payment approvals.
 */
import {revalidateTag,  revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { getWholesaleSession } from "@/lib/wholesale";
import { requirePerm } from "@/lib/auth";

const MODES = new Set(["video_call", "store_visit", "whatsapp"]);

/** Resolve a catalogue SKU (which may be a VARIANT sku like RR3071-Gold) to its parent product. */
async function resolveProduct(sb: ReturnType<typeof supabaseServer>, sku: string) {
  const clean = String(sku ?? "").trim();
  if (!clean) return null;
  const { data: p } = await sb.from("products").select("id,name,sku").ilike("sku", clean).maybeSingle();
  if (p) return p as any;
  const { data: v } = await sb.from("variants").select("product:products(id,name,sku)").ilike("sku", clean).maybeSingle();
  return ((v as any)?.product as any) ?? null;
}

/** Dealer-side: log the enquiry. The panel opens WhatsApp straight after, so the dealer still gets an
 *  instant human reply — this record just guarantees the owner also has it in writing. */
export async function createDesignEnquiryAction(input: { sku: string; mode?: string; note?: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    const session = await getWholesaleSession();
    if (!session) return { ok: false, error: "Please sign in to your dealer account first." };
    const sb = supabaseServer();
    const prod = await resolveProduct(sb, input.sku);
    const mode = MODES.has(String(input.mode)) ? String(input.mode) : "whatsapp";
    const { error } = await (sb.from("design_enquiries") as any).insert({
      product_id: prod?.id ?? null,
      sku: input.sku ?? null,
      product_name: prod?.name ?? null,
      dealer_name: (session as any).name ?? null,
      dealer_phone: (session as any).phone ?? null,
      mode,
      note: (input.note ?? "").toString().trim().slice(0, 500) || null,
      status: "new",
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/enquiries");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send the request." };
  }
}

/** Owner-side: mark an enquiry contacted/closed as he works through them. */
export async function updateDesignEnquiryAction(input: { id: string; status: string; adminNote?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const status = ["new", "contacted", "closed"].includes(input.status) ? input.status : "new";
  const sb = supabaseServer();
  const { error } = await (sb.from("design_enquiries") as any).update({
    status,
    admin_note: (input.adminNote ?? "").trim() || null,
    handled_at: status === "new" ? null : new Date().toISOString(),
  }).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/enquiries");
  return { ok: true };
}

/** Owner-side: flag ONE design as "more colours available off-catalogue". */
export async function setMoreDesignsAction(input: { sku: string; on: boolean; note?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const sb = supabaseServer();
  const { error } = await (sb.from("products") as any)
    .update({ more_designs: !!input.on, more_designs_note: (input.note ?? "").trim() || null })
    .ilike("sku", String(input.sku ?? "").trim());
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/catalogue");
  revalidatePath("/trade"); revalidateTag("trade-catalog");
  return { ok: true };
}

/** Owner-side: flag a WHOLE category at once — with 4,000+ products, one-by-one would be unusable. */
export async function bulkSetMoreDesignsAction(input: { categoryId: string; on: boolean; note?: string }): Promise<{ ok: boolean; count?: number; error?: string }> {
  if (!(await requirePerm("catalog.edit"))) return { ok: false, error: "not permitted" };
  const sb = supabaseServer();
  const { data, error } = await (sb.from("products") as any)
    .update({ more_designs: !!input.on, more_designs_note: (input.note ?? "").trim() || null })
    .eq("category_id", input.categoryId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/catalogue");
  revalidatePath("/trade"); revalidateTag("trade-catalog");
  return { ok: true, count: ((data as any[]) ?? []).length };
}
