/**
 * lib/inventory.ts — PURE inventory classifier (no I/O). Requirement 6.
 *
 * Default rule: an item is problematic if no movement in `deadDays` days
 * OR stock <= `lowQty` pieces. The rule is configurable (Req 6.2).
 */

export type StockClass = "healthy" | "low" | "dead" | "inactive";

export type InventoryRule = {
  /** days of no movement after which an item is considered stale */
  deadDays: number;
  /** quantity at or below which an item is considered low */
  lowQty: number;
};

export const DEFAULT_RULE: InventoryRule = { deadDays: 30, lowQty: 2 };

export type ItemState = {
  qty: number;
  /** ISO string or Date of last stock movement (sale/purchase/return); null = never moved */
  lastMovementAt: string | Date | null;
};

function daysBetween(now: Date, then: Date): number {
  const ms = now.getTime() - then.getTime();
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * Classify a single item. Pure & deterministic given `now`.
 *
 *  - inactive : never moved (no movement timestamp) and not in stock turnover
 *  - dead     : in stock but stale beyond deadDays (capital tied up, not selling)
 *  - low      : moving recently but stock at/below lowQty
 *  - healthy  : everything else
 *
 * Precedence: out-of-stock & stale -> dead; never-moved -> inactive; then dead, then low.
 */
export function classify(item: ItemState, rule: InventoryRule, now: Date): StockClass {
  const qty = Number.isFinite(item.qty) ? item.qty : 0;

  if (item.lastMovementAt == null) {
    // Never moved at all. If it has stock sitting unsold it's inactive dead weight.
    return "inactive";
  }

  const last = item.lastMovementAt instanceof Date ? item.lastMovementAt : new Date(item.lastMovementAt);
  const stale = daysBetween(now, last) >= rule.deadDays;

  if (stale) return "dead";
  if (qty <= rule.lowQty) return "low";
  return "healthy";
}

export type ClassifiedItem<T> = T & { stockClass: StockClass };

/** Classify a list, attaching stockClass to each. */
export function classifyAll<T extends ItemState>(
  items: T[],
  rule: InventoryRule,
  now: Date
): ClassifiedItem<T>[] {
  return items.map((it) => ({ ...it, stockClass: classify(it, rule, now) }));
}

/** Count items per class — drives dashboard tiles (Req 6.3, 7.1). */
export function summarize<T extends ItemState>(
  items: T[],
  rule: InventoryRule,
  now: Date
): Record<StockClass, number> {
  const acc: Record<StockClass, number> = { healthy: 0, low: 0, dead: 0, inactive: 0 };
  for (const it of items) acc[classify(it, rule, now)]++;
  return acc;
}
