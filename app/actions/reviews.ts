"use server";
import { revalidatePath, revalidateTag } from "next/cache";
import { requirePerm } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase/server";

/** Add a homepage "Happy Divas" review — with an optional customer photo. Shows in the storefront
 *  reviews section (photo reviews are surfaced first). product_id is null = a general featured review. */
export async function addFeaturedReviewAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("reviews.respond"))) return;
  const author = String(formData.get("author_name") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const rating = Math.min(5, Math.max(1, Math.round(Number(formData.get("rating") ?? 5)) || 5));
  const image = String(formData.get("image_url") ?? "").trim() || null;
  if (!author || !body) return;
  await supabaseServer().from("reviews").insert({ author_name: author, rating, body, image_url: image, product_id: null });
  revalidatePath("/admin/reviews"); revalidatePath("/shop"); revalidateTag("storefront");
}

/** Remove a review (junk / test / outdated). */
export async function deleteReviewAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("reviews.respond"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await supabaseServer().from("reviews").delete().eq("id", id);
  revalidatePath("/admin/reviews"); revalidatePath("/shop"); revalidateTag("storefront");
}
