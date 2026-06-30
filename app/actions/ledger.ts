"use server";
/** Lazy-loader for the Product Stock Ledger drawer. Paginated so a SKU with thousands of
 *  movements streams in pages instead of all at once. Read-gated by inventory.view. */
import { getProductLedger, type ProductLedger } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";

export async function fetchProductLedgerAction(
  productId: string,
  opts: { offset?: number; limit?: number } = {},
): Promise<ProductLedger | null> {
  if (!(await requirePerm("inventory.view"))) return null;
  return getProductLedger(productId, opts);
}
