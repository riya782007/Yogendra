/**
 * lib/stockKind.ts — pure classification of a stock movement (Phase 6/9).
 *
 * Maps a free-text "source" label (chosen in the UI or typed by DIVA) to a typed
 * movement KIND used for reporting and the audit trail. Pure & dependency-free so
 * it can be unit-tested without a backend.
 */
export type StockKind = "purchase" | "sale" | "return" | "damage" | "recount" | "correction" | "manual";

export function inferStockKind(source: string): StockKind {
  const s = (source ?? "").toLowerCase();
  if (/(damage|broken|lost|defect)/.test(s)) return "damage";
  if (/(purchase|restock|received|supplier)/.test(s)) return "purchase";
  if (/(return|cancel|sample)/.test(s)) return "return";
  if (/(found|recount|count)/.test(s)) return "recount";
  if (/(correct)/.test(s)) return "correction";
  if (/(sold|sale|pos)/.test(s)) return "sale";
  return "manual";
}
