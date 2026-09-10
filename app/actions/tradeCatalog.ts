"use server";
import { TRADE_PAGE_SIZE, getTradeSlice, getTradeSliceCached, type TradeFilter } from "@/lib/catalogSlice";

export async function loadTradeSliceAction(offset: number, filter: TradeFilter = {}) {
  const f: TradeFilter = {
    category: filter.category,
    sub: filter.sub,
    style: filter.style,
    q: filter.q,
    // Colour is filtered on the server now. It used to be dropped here, so a dealer's colour choice
    // never left the browser and only ever filtered the designs already on screen.
    colour: filter.colour,
  };
  try {
    return await getTradeSliceCached(Math.max(0, offset), TRADE_PAGE_SIZE, f);
  } catch {
    try {
      return await getTradeSlice(Math.max(0, offset), TRADE_PAGE_SIZE, f);
    } catch {
      return { list: [] as Awaited<ReturnType<typeof getTradeSlice>>["list"], hasMore: false };
    }
  }
}
