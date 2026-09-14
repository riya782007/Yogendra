"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";
/** Park an estimate ON HOLD and RESERVE its stock — the committed pieces are set aside for a regular
 *  customer to collect within ~15 days (owner's real workflow). hold_estimate deducts them from sellable
 *  stock (so they can't be sold to anyone else and don't show as available) but posts NO revenue — it's
 *  not a sale yet. Billing later releases the hold and charges only the quantity actually taken; the rest
 *  returns to stock. Resume/Deny release it. Blocks (with a clear message) if stock is short. */
export async function holdEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const { error } = await supabaseServer().rpc("hold_estimate", { p_estimate_id: id });
  if (error) redirect(`/admin/estimates?holderror=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

/** Convert a backorder into a fulfilled sale once stock has arrived — clears the backorder flag so
 *  it drops off the Backorders list and counts as a normal completed sale. */
export async function fulfillBackorderAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  // fulfill_backorder is ALL-OR-NOTHING: it re-checks stock on every line (blocks with a clear
  // error if still short), THEN moves stock + logs the sale movements + posts revenue + releases
  // the bill into the sales record. The old flag-flip skipped all of that.
  const { error } = await supabaseServer().rpc("fulfill_backorder", { p_order_id: id });
  revalidatePath("/admin/backorders"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  if (!error) revalidateTag("storefront"); // stock moves on fulfilment → refresh the shop
  if (error) redirect(`/admin/backorders?err=${encodeURIComponent(error.message)}`);
  redirect("/admin/backorders?ok=1");
}
