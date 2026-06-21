"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { groqChat, openaiChat, groqConfigured, openaiConfigured } from "@/lib/ai/providers";

export async function draftReviewReplyAction(reviewId: string): Promise<{ ok: boolean; reply: string }> {
  const sb = supabaseServer();
  const { data: r } = await sb.from("reviews").select("author_name,rating,body,product:products(name)").eq("id", reviewId).maybeSingle();
  if (!r) return { ok: false, reply: "" };
  const review = r as any;
  const system = `You write warm, gracious, concise public replies (max 2 sentences) on behalf of "Blythe Diva", a premium artificial-jewellery brand. Thank the customer by first name, be specific to their words, and stay brand-appropriate. For low ratings, apologise sincerely and invite them to WhatsApp +91 98731 51767. No hashtags, at most one emoji.`;
  const user = `Product: ${review.product?.name}. Rating: ${review.rating}/5. Review: "${review.body}". Reviewer: ${review.author_name}. Write the reply only.`;
  try {
    let reply: string;
    if (groqConfigured()) reply = await groqChat({ system, user });
    else if (openaiConfigured()) reply = await openaiChat({ system, user });
    else reply = `Thank you so much, ${String(review.author_name).split(" ")[0]}! We're so glad you love it — your support means the world to Blythe Diva. ✦`;
    return { ok: true, reply: reply.trim() };
  } catch {
    return { ok: true, reply: `Thank you, ${String(review.author_name).split(" ")[0]}! We truly appreciate your review and hope to delight you again soon. ✦` };
  }
}

export async function saveReviewReplyAction(reviewId: string, text: string): Promise<{ ok: boolean }> {
  await supabaseServer().from("reviews").update({ response: text, responded_at: new Date().toISOString() }).eq("id", reviewId);
  revalidatePath("/admin/reviews");
  return { ok: true };
}
