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
  id: string; created_at: string; sku: string | null; delta: number; kind: string | null; ref_id?: string | null;
  source: string | null; reason: string | null; created_by: string | null;
  product?: { name: string | null; sku: string | null; base_wholesale?: number | null } | null; variant?: { color: string | null } | null;
};

/**
 * VALUE of a hand-made change (owner, Oct 2026): "Adjust stock me record maintain in terms of amount
 * hona chahiye … WE798 nahi mil raha 2 pcs → 2×32 = ₹64 loss; WE804 extra mila 1 pc → +₹32. Net ₹32
 * loss. Year end tally pe pura adjustment record hoga."
 * Valued at the piece's COST — products.base_wholesale, the base (purchase) rate every price is built
 * from. Paise. Positive = stock gained, negative = stock lost.
 */
export const KIND_MANUAL = new Set(["adjustment", "correction", "recount", "manual", "damage", "move"]);
export const isManualRow = (r: { kind?: string | null; ref_id?: string | null }) =>
  KIND_MANUAL.has(String(r.kind ?? "")) || (r.kind === "return" && !r.ref_id);
export const ratePaise = (r: { product?: { base_wholesale?: number | null } | null }) =>
  Number.isFinite(Number(r.product?.base_wholesale)) ? Number(r.product!.base_wholesale) : null;
export const valuePaise = (r: { delta: number; product?: { base_wholesale?: number | null } | null }) => {
  const rate = ratePaise(r); return rate == null ? null : r.delta * rate;
};

/** 1 April of the current Indian financial year, as an ISO timestamp (IST midnight). */
export function financialYearStart(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const y = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1) - 330 * 60_000).toISOString();
}

export type AdjustmentValueSummary = { addedPaise: number; removedPaise: number; netPaise: number; addedPcs: number; removedPcs: number; rows: number; unpriced: number; from: string; to?: string };

/** Totals of every hand-made change between `from` and `to` (default: this financial year to date). */
export async function getAdjustmentValueSummary(from = financialYearStart(), to?: string): Promise<AdjustmentValueSummary> {
  const sb = supabaseServer();
  const out: AdjustmentValueSummary = { addedPaise: 0, removedPaise: 0, netPaise: 0, addedPcs: 0, removedPcs: 0, rows: 0, unpriced: 0, from, to };
  for (let off = 0; off < 50_000; off += 1000) {
    let q = sb.from("stock_adjustments").select("delta,kind,ref_id, product:products(base_wholesale)")
      .or(MANUAL_ADJUSTMENT_OR).gte("created_at", from);
    if (to) q = q.lte("created_at", to);
    const { data } = await q.order("created_at", { ascending: true }).range(off, off + 999);
    const rows = (data as any[]) ?? [];
    for (const r of rows) {
      out.rows++;
      const v = valuePaise(r);
      if (r.delta > 0) out.addedPcs += r.delta; else out.removedPcs += -r.delta;
      if (v == null) { out.unpriced++; continue; }
      if (v > 0) out.addedPaise += v; else out.removedPaise += -v;
    }
    if (rows.length < 1000) break;
  }
  out.netPaise = out.addedPaise - out.removedPaise;
  return out;
}

export async function getAdjustmentRecord(limit = 15): Promise<AdjustmentRow[]> {
  const { data } = await supabaseServer().from("stock_adjustments")
    .select("id,created_at,sku,delta,kind,ref_id,source,reason,created_by, product:products(name,sku,base_wholesale), variant:variants(color)")
    .or(MANUAL_ADJUSTMENT_OR)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as any[]) ?? [];
}
