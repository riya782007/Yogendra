"use server";
import { TRADE_PAGE_SIZE, getTradeSlice, getTradeSliceCached } from "@/lib/catalogSlice";

export async function loadTradeSliceAction(offset: number) {
  try {
    return await getTradeSliceCached(Math.max(0, offset), TRADE_PAGE_SIZE);
  } catch {
    try {
      return await getTradeSlice(Math.max(0, offset), TRADE_PAGE_SIZE);
    } catch {
      return { list: [] as Awaited<ReturnType<typeof getTradeSlice>>["list"], hasMore: false };
    }
  }
}
