"use server";
/**
 * "Notify Me" — a storefront customer asks to be told when an out-of-stock product is back.
 * Public (no auth). Stored in notify_requests; surfaced to the owner in Admin → Notify-Me.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";

export async function requestNotifyAction(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const sku = String(formData.get("sku") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim();
  if (!sku) return { ok: false, error: "Missing product." };
  if (!/^[+\d][\d\s-]{6,}$/.test(phone)) return { ok: false, error: "Please enter a valid phone number." };

  const sb = supabaseServer();
  const { data: prod } = await sb.from("products").select("id").eq("sku", sku).maybeSingle();
  const { error } = await sb.from("notify_requests").insert({
    product_id: (prod as any)?.id ?? null,
    sku,
    customer_name: name,
    customer_phone: phone,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/notify");
  return { ok: true };
}
