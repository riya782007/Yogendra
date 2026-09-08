"use server";
import { getTradeSlice } from "@/lib/catalogSlice";

export async function loadTradeSliceAction(offset: number) {
  try {
    return await getTradeSlice(Math.max(0, offset), 48);
  } catch {
    return { list: [] as Awaited<ReturnType<typeof getTradeSlice>>["list"], hasMore: false };
  }
}
