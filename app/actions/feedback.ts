"use server";
import { supabaseServer } from "@/lib/supabase/server";

/** #39: a customer submits store feedback from the public form. No auth — anyone can leave it. */
export async function submitFeedbackAction(input: {
  name?: string; phone?: string; rating?: number; message?: string; orderRef?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const rating = Math.min(5, Math.max(0, Math.round(Number(input.rating) || 0)));
  const message = String(input.message ?? "").trim();
  if (!rating && !message) return { ok: false, error: "Please add a rating or a message." };
  const { error } = await supabaseServer().from("feedback").insert({
    name: input.name?.trim() || null,
    phone: input.phone?.trim() || null,
    rating: rating || null,
    message: message || null,
    order_ref: input.orderRef?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
