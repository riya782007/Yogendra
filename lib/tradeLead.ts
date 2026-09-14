/** Whether the wholesale visitor card should cover the catalogue. */
export function shouldOpenTradeLead(totalDesigns: number, alreadySubmitted: boolean): boolean {
  // Never dim an empty/failed catalogue — that is the "black screen" dealers reported.
  return totalDesigns > 0 && !alreadySubmitted;
}
