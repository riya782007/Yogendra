"use server";
/**
 * OPEN RETURNS — goods coming back WITHOUT a bill.
 *
 * The owner sells to marketplaces (Myntra and similar); stock comes back weeks later, mixed across
 * several invoices and impossible to pin to one bill. The bill-linked return flow can't express that,
 * so those pieces used to sit outside the system entirely.
 *
 * This records the same three facts a bill-linked return does — stock goes back on the shelf, the
 * movement is written to the ledger, and the register shows what came back from whom — minus the
 * invoice requirement. Money is deliberately OPTIONAL: a marketplace return is usually a credit note,
 * not cash out of the drawer, so the owner records a value only when one actually applies.
 */
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

export type OpenReturnLine = { sku: string; qty: number };

/** Resolve a scanned/typed SKU to its product + variant (variant SKU wins — that's the barcode). */
async function resolveSku(sb: ReturnType<typeof supabaseServer>, raw: string) {
  const sku = String(raw ?? "").trim();
  if (!sku) return null;
  const { data: v } = await sb.from("variants").select("id,sku,qty,product_id").ilike("sku", sku).maybeSingle();
  if (v) return { productId: (v as any).product_id as string, variantId: (v as any).id as string, sku: (v as any).sku as string, qty: (v as any).qty ?? 0 };
  const { data: p } = await sb.from("products").select("id,sku,qty").ilike("sku", sku).maybeSingle();
  if (!p) return null;
  // A product with exactly one colour: put the goods back on that colour, not a phantom product total.
  const { data: vs } = await sb.from("variants").select("id,sku,qty").eq("product_id", (p as any).id);
  const list = ((vs as any[]) ?? []);
  if (list.length === 1) return { productId: (p as any).id as string, variantId: list[0].id as string, sku: list[0].sku as string, qty: list[0].qty ?? 0 };
  if (list.length > 1) return null;   // ambiguous — the owner must name the colour
  return { productId: (p as any).id as string, variantId: null, sku: (p as any).sku as string, qty: (p as any).qty ?? 0 };
}

export async function createOpenReturnAction(input: {
  lines: OpenReturnLine[];
  party?: string;
  reason?: string;
  amountRupees?: number;
  refundFromMethodId?: string;   // only when cash actually leaves the drawer
}): Promise<{ ok: boolean; error?: string; restocked?: number; skipped?: string[] }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "not permitted" };

  const lines = (input.lines ?? [])
    .map((l) => ({ sku: String(l.sku ?? "").trim(), qty: Math.floor(Number(l.qty) || 0) }))
    .filter((l) => l.sku && l.qty > 0);
  if (!lines.length) return { ok: false, error: "Add at least one item with a quantity." };

  const sb = supabaseServer();
  const amount = Math.max(0, Math.round((Number(input.amountRupees) || 0) * 100));
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  // Header first, so every movement can point at it (return_id) and the register groups them.
  const { data: ret, error: rErr } = await (sb.from("returns") as any).insert({
    kind: "sales",
    ref_order_id: null,
    party: (input.party ?? "").trim() || null,
    reason: (input.reason ?? "").trim() || "Return without bill",
    qty: totalQty,
    amount,
  }).select("id").single();
  if (rErr) return { ok: false, error: rErr.message };
  const returnId = (ret as any).id as string;

  let restocked = 0;
  const skipped: string[] = [];
  for (const l of lines) {
    const hit = await resolveSku(sb, l.sku);
    if (!hit) { skipped.push(l.sku); continue; }

    // Put the pieces back. Writing qty + delta separately keeps the products/variants trigger honest.
    if (hit.variantId) {
      await sb.from("variants").update({ qty: (hit.qty ?? 0) + l.qty }).eq("id", hit.variantId);
    } else {
      await sb.from("products").update({ qty: (hit.qty ?? 0) + l.qty }).eq("id", hit.productId);
    }

    await (sb.from("stock_adjustments") as any).insert({
      product_id: hit.productId,
      variant_id: hit.variantId,
      sku: hit.sku,
      delta: l.qty,
      kind: "return",
      source: "Return (no bill)",
      reason: (input.party ?? "").trim() ? `Returned by ${input.party!.trim()}` : "Returned without a bill",
      return_id: returnId,
      created_by: "owner",
    });
    restocked += l.qty;
  }

  // Cash only moves if the owner says it did — a marketplace return is normally a credit note.
  if (amount > 0 && input.refundFromMethodId) {
    await (sb.from("payment_method_transactions") as any).insert({
      method_id: input.refundFromMethodId, txn_type: "refund", direction: "out", amount,
      ref_type: "return", ref_id: returnId, note: "Refund on return without bill", created_by: "owner",
    });
  }

  revalidatePath("/admin/returns");
  revalidatePath("/admin/stock-movements");
  return { ok: true, restocked, skipped };
}
