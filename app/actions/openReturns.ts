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
import { revalidatePath, revalidateTag } from "next/cache";
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

export type OpenPurchaseReturnLine = { sku: string; qty: number; unitCostRupees?: number };

/** Last purchase unit cost (paise) for this product/variant — used to pre-fill the debit note. */
async function lastPurchaseCostPaise(
  sb: ReturnType<typeof supabaseServer>,
  productId: string,
  variantId: string | null,
): Promise<number> {
  if (variantId) {
    const { data } = await sb.from("purchase_items")
      .select("unit_cost,id")
      .eq("mapped_product_id", productId).eq("variant_id", variantId)
      .order("id", { ascending: false }).limit(1);
    const c = ((data as any[]) ?? [])[0]?.unit_cost;
    if (Number(c) > 0) return Number(c);
  }
  const { data } = await sb.from("purchase_items")
    .select("unit_cost,id")
    .eq("mapped_product_id", productId)
    .order("id", { ascending: false }).limit(1);
  return Number(((data as any[]) ?? [])[0]?.unit_cost) || 0;
}

/** Live SKU lookup for the open purchase-return form (stock on hand + last cost + name). */
export async function lookupPurchaseReturnSkuAction(raw: string): Promise<{
  ok: boolean; sku?: string; name?: string; color?: string | null; qty?: number; lastCostPaise?: number; error?: string;
}> {
  if (!(await requirePerm("billing.refund")) && !(await requirePerm("purchases.create"))) {
    return { ok: false, error: "not permitted" };
  }
  const sb = supabaseServer();
  const hit = await resolveSku(sb, raw);
  if (!hit) return { ok: false, error: "SKU not found — type the colour SKU if this design has more than one colour." };
  let name = hit.sku;
  let color: string | null = null;
  const { data: p } = await sb.from("products").select("name").eq("id", hit.productId).maybeSingle();
  if ((p as any)?.name) name = (p as any).name;
  if (hit.variantId) {
    const { data: v } = await sb.from("variants").select("color,qty").eq("id", hit.variantId).maybeSingle();
    color = (v as any)?.color ?? null;
  }
  const lastCostPaise = await lastPurchaseCostPaise(sb, hit.productId, hit.variantId);
  return { ok: true, sku: hit.sku, name, color, qty: hit.qty, lastCostPaise };
}

/**
 * OPEN PURCHASE RETURN — goods going BACK TO THE SUPPLIER without pinning a purchase bill.
 *
 * Mirrors createOpenReturnAction (sales / marketplace) but in the opposite direction: stock leaves
 * the shelf (never below zero), a debit-note header is written, and the owner gets a shareable
 * document at /admin/returns/[id]. Bill-linked purchase returns (record_purchase_return RPC) are
 * untouched — this path is only used when there is no bill to select.
 */
export async function createOpenPurchaseReturnAction(input: {
  lines: OpenPurchaseReturnLine[];
  supplierId?: string;
  party?: string;
  reason?: string;
  creditToMethodId?: string; // only when the supplier actually paid cash/UPI back
}): Promise<{ ok: boolean; error?: string; returnId?: string; qty?: number; amount?: number; skipped?: string[] }> {
  if (!(await requirePerm("billing.refund")) && !(await requirePerm("purchases.create"))) {
    return { ok: false, error: "Your role can't record purchase returns." };
  }

  const lines = (input.lines ?? [])
    .map((l) => ({
      sku: String(l.sku ?? "").trim(),
      qty: Math.floor(Number(l.qty) || 0),
      unitCostPaise: Math.max(0, Math.round((Number(l.unitCostRupees) || 0) * 100)),
    }))
    .filter((l) => l.sku && l.qty > 0);
  if (!lines.length) return { ok: false, error: "Add at least one item with a quantity." };

  const sb = supabaseServer();
  const reason = (input.reason ?? "").trim() || "Purchase return without bill";

  let supplierName = (input.party ?? "").trim();
  let supplierPhone: string | null = null;
  if (input.supplierId) {
    const { data: s } = await sb.from("suppliers").select("id,name,phone").eq("id", input.supplierId).maybeSingle();
    if (s) {
      supplierName = ((s as any).name as string) || supplierName;
      supplierPhone = ((s as any).phone as string) || null;
    }
  }
  if (!supplierName) return { ok: false, error: "Select or name the supplier — the debit note needs a party." };

  // Resolve + stock-check EVERY line first so we never leave a half-applied return.
  const resolved: { productId: string; variantId: string | null; sku: string; qty: number; onHand: number; unitCostPaise: number; name: string }[] = [];
  const skipped: string[] = [];
  for (const l of lines) {
    const hit = await resolveSku(sb, l.sku);
    if (!hit) { skipped.push(l.sku); continue; }
    const onHand = hit.qty ?? 0;
    if (onHand < l.qty) {
      return { ok: false, error: `${hit.sku} has only ${onHand} in stock — you tried to return ${l.qty}. Sold pieces cannot be sent back.` };
    }
    let cost = l.unitCostPaise;
    if (!cost) cost = await lastPurchaseCostPaise(sb, hit.productId, hit.variantId);
    resolved.push({ productId: hit.productId, variantId: hit.variantId, sku: hit.sku, qty: l.qty, onHand, unitCostPaise: cost, name: hit.sku });
  }
  if (!resolved.length) return { ok: false, error: skipped.length ? `SKU(s) not found: ${skipped.join(", ")}. For multi-colour designs, type the colour SKU.` : "Nothing to return." };

  const totalQty = resolved.reduce((s, r) => s + r.qty, 0);
  const amount = resolved.reduce((s, r) => s + r.unitCostPaise * r.qty, 0);
  const now = new Date().toISOString();

  const { data: ret, error: rErr } = await (sb.from("returns") as any).insert({
    kind: "purchase",
    ref_order_id: null,
    party: supplierName,
    reason,
    qty: totalQty,
    amount,
  }).select("id").single();
  if (rErr) return { ok: false, error: rErr.message };
  const returnId = (ret as any).id as string;

  for (const r of resolved) {
    const newQty = r.onHand - r.qty;
    if (r.variantId) {
      const up = await sb.from("variants").update({ qty: newQty }).eq("id", r.variantId).eq("qty", r.onHand).select("id");
      if (up.error) return { ok: false, error: up.error.message };
      if (!((up.data as any[]) ?? []).length) return { ok: false, error: `${r.sku} stock changed while saving — refresh and try again.` };
      const { data: siblings } = await sb.from("variants").select("qty").eq("product_id", r.productId);
      const total = ((siblings as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
      await sb.from("products").update({ qty: total, last_movement_at: now }).eq("id", r.productId);
    } else {
      const up = await sb.from("products").update({ qty: newQty, last_movement_at: now }).eq("id", r.productId).eq("qty", r.onHand).select("id");
      if (up.error) return { ok: false, error: up.error.message };
      if (!((up.data as any[]) ?? []).length) return { ok: false, error: `${r.sku} stock changed while saving — refresh and try again.` };
    }
    await (sb.from("stock_adjustments") as any).insert({
      product_id: r.productId,
      variant_id: r.variantId,
      sku: r.sku,
      delta: -r.qty,
      kind: "purchase_return",
      source: "Purchase return (no bill)",
      reason: `Returned ${r.qty} to ${supplierName}${r.unitCostPaise ? ` @ ₹${(r.unitCostPaise / 100).toFixed(2)}` : ""} — ${reason}`,
      return_id: returnId,
      created_by: "owner",
    });
  }

  if (amount > 0) {
    const { data: balRow } = await sb.from("ledger").select("balance").order("created_at", { ascending: false }).limit(1);
    const vBal = Number(((balRow as any[]) ?? [])[0]?.balance) || 0;
    await (sb.from("ledger") as any).insert({
      kind: "purchase", ref_id: returnId, debit: 0, credit: amount, balance: vBal + amount,
      note: `Purchase return (debit note, no bill): ${reason}`,
    });
  }

  if (amount > 0 && input.creditToMethodId) {
    await (sb.from("payment_method_transactions") as any).insert({
      method_id: input.creditToMethodId, txn_type: "refund", direction: "in", amount,
      ref_type: "return", ref_id: returnId, note: `Supplier credit on return without bill · ${supplierName}`, created_by: "owner",
    });
  }

  await sb.from("audit_log").insert({
    actor: "owner", action: "purchase_return", ref: returnId,
    detail: JSON.stringify({
      no_bill: true, supplier: supplierName, phone: supplierPhone, qty: totalQty, amount, reason,
      lines: resolved.map((r) => ({ sku: r.sku, qty: r.qty, unit_cost: r.unitCostPaise })),
    }),
  });

  revalidatePath("/admin/returns");
  revalidatePath("/admin/stock-movements");
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/catalogue");
  revalidatePath("/admin/purchases");
  revalidatePath("/admin/cashbook");
  revalidateTag("storefront");
  return { ok: true, returnId, qty: totalQty, amount, skipped };
}
