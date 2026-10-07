/**
 * ADJUSTMENT RECORD — every hand-made stock change (Adjust stock and Move stock), newest first.
 *
 * Owner (Oct 2026): "Adjust stock ka record". Manual adjustments were stored, but they're tagged with a
 * kind guessed from the reason (correction / recount / damage / return / manual), so the "Adjustments"
 * filter on Stock Movement History (which looked for kind = 'adjustment') always came up empty. This is
 * the one definition of "made by hand" both screens now use:
 *   · kinds only Adjust/Move produce: adjustment, correction, recount, manual, damage, move
 *   · plus 'return' rows with NO linked bill (Returned from cart / Customer cancelled / Sample returned);
 *     bill returns always carry the bill as ref_id, so they stay out.
 * Shown on the Inventory page (last 12) and on Stock Movement History (filter "Adjustments & moves").
 */
import { supabaseServer } from "@/lib/supabase/server";

export const MANUAL_ADJUSTMENT_OR = "kind.in.(adjustment,correction,recount,manual,damage,move),and(kind.eq.return,ref_id.is.null)";

export type AdjustmentRow = {
  id: string; created_at: string; sku: string | null; delta: number; kind: string | null;
  source: string | null; reason: string | null; created_by: string | null;
  product?: { name: string | null; sku: string | null } | null; variant?: { color: string | null } | null;
};

export async function getAdjustmentRecord(limit = 15): Promise<AdjustmentRow[]> {
  const { data } = await supabaseServer().from("stock_adjustments")
    .select("id,created_at,sku,delta,kind,source,reason,created_by, product:products(name,sku), variant:variants(color)")
    .or(MANUAL_ADJUSTMENT_OR)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as any[]) ?? [];
}
