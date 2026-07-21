"use server";
import { revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm } from "@/lib/auth";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

export async function createSupplierAction(input: FormData | { name: string; city?: string }): Promise<{ ok: boolean; error?: string; duplicate?: boolean }> {
  if (!(await requirePerm("purchases.create"))) return { ok: false, error: "Your role can't add suppliers." };
  const name = String((input instanceof FormData ? input.get("name") : input.name) ?? "").trim();
  const city = String((input instanceof FormData ? input.get("city") : input.city) ?? "").trim();
  if (!name) return { ok: false, error: "Enter a supplier name." };
  const sb = supabaseServer();
  // Dedupe (case-insensitive by name) so a double/triple click — or re-submitting the same details —
  // never creates duplicate suppliers. If it already exists, we just treat it as done.
  const { data: existing } = await sb.from("suppliers").select("id").ilike("name", name).maybeSingle();
  if (existing) { revalidatePath("/admin/purchases"); return { ok: true, duplicate: true }; }
  const { error } = await sb.from("suppliers").insert({ name, city: city || null });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/purchases");
  return { ok: true };
}

/** Delete a supplier — but ONLY if it has no purchases (else the books would lose their link).
 *  The client asks for confirmation before calling this. */
export async function deleteSupplierAction(input: { supplierId: string }): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("purchases.create"))) return { ok: false, error: "Your role can't manage suppliers." };
  const id = (input.supplierId ?? "").trim();
  if (!id) return { ok: false, error: "Missing supplier." };
  const sb = supabaseServer();
  const { count } = await sb.from("purchases").select("id", { count: "exact", head: true }).eq("supplier_id", id);
  if ((count ?? 0) > 0) return { ok: false, error: `Can't delete — this supplier has ${count} purchase${count === 1 ? "" : "s"} on record. Keep it for the books.` };
  const { error } = await sb.from("suppliers").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/purchases");
  return { ok: true };
}

/**
 * Map an unmapped purchase line to a product. An unmapped line never added its stock at purchase
 * time (there was no product to add to), so mapping it now applies that missing stock. The bill
 * total / ledger already counted this line, so money is untouched.
 */
export async function mapPurchaseLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("purchases.create"))) return;
  const lineId = String(formData.get("line_id") ?? "").trim();
  const productId = String(formData.get("product_id") ?? "").trim();
  const purchaseId = String(formData.get("purchase_id") ?? "").trim();
  if (!lineId || !productId) return;
  const sb = supabaseServer();
  await sb.rpc("map_purchase_line", { p_line_id: lineId, p_product: productId, p_variant: null });
  if (purchaseId) revalidatePath(`/admin/purchase/${purchaseId}`);
  revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}

/** Low-risk edit of a purchase's bill number / supplier — direct, permissioned. */
export async function updatePurchaseAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("purchases.create"))) return;
  const id = String(formData.get("id") ?? "");
  const billNo = String(formData.get("bill_no") ?? "").trim();
  const supplierId = String(formData.get("supplier_id") ?? "").trim();
  if (!id) return;
  const row: any = { bill_no: billNo || null };
  if (supplierId) row.supplier_id = supplierId;
  await supabaseServer().from("purchases").update(row).eq("id", id);
  revalidatePath(`/admin/purchase/${id}`); revalidatePath("/admin/purchases");
}

/**
 * Sensitive: deleting a purchase reverses stock & the ledger, so it can't be done directly —
 * it raises an approval request that the owner must clear with the OTP (2FA) on /admin/approvals.
 */
export async function requestPurchaseDeletionAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("purchases.create"))) return;
  const id = String(formData.get("id") ?? "");
  const billNo = String(formData.get("bill_no") ?? "");
  if (!id) return;
  const sb = supabaseServer();
  // Avoid duplicate pending requests for the same purchase.
  const { data: dup } = await sb.from("approvals").select("id").eq("action", "delete_purchase").eq("status", "pending").contains("payload", { purchase_id: id }).maybeSingle();
  if (dup) { revalidatePath("/admin/approvals"); return; }
  await sb.from("approvals").insert({
    action: "delete_purchase",
    payload: { purchase_id: id, bill_no: billNo },
    status: "pending",
    otp_hash: `h:${OWNER_OTP()}`,
  });
  revalidatePath("/admin/approvals"); revalidatePath(`/admin/purchase/${id}`);
}

export type PurchaseLine = { supplierSku: string; mappedProductId: string; variantId?: string; qty: number; unitCostRupees: number };

const normSku = (s: string) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Two colour/suffix tokens are the "same" if one is a prefix of the other (≥3 chars) — so GOLD
 *  matches GOLDEN, SILVER matches SILVERY, RUBY matches RUBYRED. Prevents a tiny spelling difference
 *  in the supplier's SKU from leaving a line unmapped. */
const colourMatch = (a: string, b: string) => {
  const x = normSku(a), y = normSku(b);
  if (!x || !y) return false;
  return x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y));
};

/**
 * Resolve any purchase lines the client left UNMAPPED, using FRESH, COMPLETE database data. The
 * browser's paste-time matcher can miss a SKU when the product/variant was created after the page
 * loaded, or when the supplier spelled a colour slightly differently (GOLDEN vs GOLD). Matching here
 * — at save time — guarantees the stock lands on the right design. Tries, in order: exact variant SKU,
 * exact product SKU, then base-SKU + fuzzy-colour variant.
 */
async function resolvePurchaseLines(sb: ReturnType<typeof supabaseServer>, items: PurchaseLine[]): Promise<PurchaseLine[]> {
  const need = items.filter((l) => !l.mappedProductId && String(l.supplierSku ?? "").trim());
  if (!need.length) return items;
  // Candidate SKUs to look up: the exact supplier SKU + its base (with the trailing "-COLOUR" removed).
  const exacts = [...new Set(need.map((l) => l.supplierSku.trim()))];
  const bases = [...new Set(exacts.map((s) => s.replace(/[-_\s][A-Za-z0-9]+$/, "")).filter(Boolean))];
  const wanted = [...new Set([...exacts, ...bases])];
  // Fetch matching products + variants in chunks (keep each request URL well under the limit).
  const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
  const esc = (s: string) => s.replace(/([,()])/g, "");
  const prodRows: any[] = []; const varRows: any[] = [];
  for (const grp of chunk(wanted, 60)) {
    const or = grp.map((s) => `sku.ilike.${esc(s)}`).join(",");
    const { data } = await sb.from("products").select("id,sku,type").or(or);
    prodRows.push(...((data as any[]) ?? []));
  }
  for (const grp of chunk(exacts, 60)) {
    const or = grp.map((s) => `sku.ilike.${esc(s)}`).join(",");
    const { data } = await sb.from("variants").select("id,product_id,sku,color").or(or);
    varRows.push(...((data as any[]) ?? []));
  }
  // Variants of the base products, for colour-fuzzy matching.
  const baseIds = [...new Set(prodRows.map((p) => p.id))];
  const varsByProduct = new Map<string, any[]>();
  for (const grp of chunk(baseIds, 100)) {
    const { data } = await sb.from("variants").select("id,product_id,sku,color").in("product_id", grp);
    for (const v of ((data as any[]) ?? [])) { const a = varsByProduct.get(v.product_id) ?? []; a.push(v); varsByProduct.set(v.product_id, a); }
  }
  const variantByExact = new Map(varRows.map((v) => [normSku(v.sku), v]));
  const productByExact = new Map(prodRows.map((p) => [normSku(p.sku), p]));

  return items.map((l) => {
    if (l.mappedProductId || !String(l.supplierSku ?? "").trim()) return l;
    const raw = l.supplierSku.trim();
    const key = normSku(raw);
    // 1) exact variant SKU
    const vex = variantByExact.get(key);
    if (vex) return { ...l, mappedProductId: vex.product_id, variantId: vex.id };
    // 2) exact product SKU
    const pex = productByExact.get(key);
    if (pex) {
      const vs = varsByProduct.get(pex.id) ?? [];
      if (!vs.length) return { ...l, mappedProductId: pex.id, variantId: undefined };
      // configurable but the supplier gave only the base — can't pick a colour, leave for manual map
      return l;
    }
    // 3) base SKU + fuzzy colour  (e.g. "WT1016-GOLDEN" → product WT1016, variant colour GOLD)
    const suffix = raw.slice(raw.replace(/[-_\s][A-Za-z0-9]+$/, "").length).replace(/[^A-Za-z0-9]/g, "");
    const baseKey = normSku(raw.replace(/[-_\s][A-Za-z0-9]+$/, ""));
    const baseProd = productByExact.get(baseKey);
    if (baseProd && suffix) {
      const vs = varsByProduct.get(baseProd.id) ?? [];
      const hit = vs.find((v) => colourMatch(v.color ?? "", suffix)) ?? vs.find((v) => colourMatch(v.sku?.split(/[-_]/).pop() ?? "", suffix));
      if (hit) return { ...l, mappedProductId: hit.product_id, variantId: hit.id };
    }
    return l; // still unmapped — owner maps it on the purchase page
  });
}

/** One leg of a split payment made at purchase time. Several may be supplied at once.
 *  `methodId` names the SPECIFIC account it went out of (HDFC / Kotak / SBI / UPI / Cash) so the
 *  same account's balance drops — exactly like POS records which account received a sale. */
export type PurchasePayment = { mode: "cash" | "upi" | "bank"; amountRupees: number; methodId?: string };

export async function recordPurchaseAction(input: {
  supplierId: string; billNo: string; items: PurchaseLine[]; force?: boolean;
  /** NEW: split the bill across several methods at once (cash + upi + bank). Remainder = credit. */
  payments?: PurchasePayment[];
  /** Legacy single-method fields — still accepted so older callers keep working. */
  paymentMode?: "cash" | "upi" | "bank" | "credit"; amountPaidRupees?: number;
  /** Optional extra charges + GST on the supplier bill (all in rupees). GST is OPTIONAL (3% input GST). */
  packingRupees?: number; shippingRupees?: number; adjustmentRupees?: number; gst?: boolean;
}): Promise<{ ok: boolean; total?: number; error?: string; duplicateBillNo?: boolean }> {
  if (!input.supplierId) return { ok: false, error: "Choose a supplier" };
  const items = (input.items ?? []).filter((l) => l.qty > 0 && l.unitCostRupees > 0);
  if (!items.length) return { ok: false, error: "Add at least one line with qty and cost" };

  const sb = supabaseServer();
  const billNo = (input.billNo ?? "").trim();
  // Warn (don't hard-block — bills do get corrected/re-entered) if this supplier already has
  // a purchase under the same bill number, so the same invoice isn't double-booked by mistake.
  if (billNo && !input.force) {
    const { data: dup } = await sb.from("purchases").select("id, created_at").eq("supplier_id", input.supplierId).eq("bill_no", billNo).limit(1).maybeSingle();
    if (dup) {
      const when = dup.created_at ? new Date(dup.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "earlier";
      return { ok: false, duplicateBillNo: true, error: `Bill "${billNo}" was already recorded for this supplier on ${when}. Record it again anyway?` };
    }
  }

  // Auto-map any lines the client couldn't (stale/incomplete browser index, or a colour spelled
  // slightly differently) using fresh DB data — so bulk-uploaded lines land on the right design.
  const mappedItems = await resolvePurchaseLines(sb, items);
  const payload = mappedItems.map((l) => ({ supplier_sku: l.supplierSku, mapped_product_id: l.mappedProductId || "", variant_id: l.variantId || "", qty: l.qty, unit_cost: Math.round(l.unitCostRupees * 100) }));
  const { data, error } = await sb.rpc("record_purchase", { p_supplier_id: input.supplierId, p_bill_no: billNo || null, p_items: payload });
  if (error) return { ok: false, error: error.message };
  const purchaseId = (data as any)?.purchase_id as string | undefined;
  const itemsTotal = (data as any)?.total as number;

  // Extra charges + optional GST fold into the recorded bill total (so the supplier ledger & payment
  // reconcile to what was actually paid). Packing/Shipping add to cost; Adjustment can be ±; GST is a
  // 3% input tax added ONLY when the owner ticks it. Best-effort: never unwinds the recorded stock.
  const rp = (n?: number) => Math.round((Number(n) || 0) * 100);
  const packing = Math.max(0, rp(input.packingRupees));
  const shipping = Math.max(0, rp(input.shippingRupees));
  const adjustment = rp(input.adjustmentRupees);
  const beforeGst = (Number(itemsTotal) || 0) + packing + shipping + adjustment;
  const gstAmt = input.gst ? Math.round((beforeGst * 3) / 100) : 0;
  const extra = (beforeGst - (Number(itemsTotal) || 0)) + gstAmt; // charges + gst on top of items
  const total = beforeGst + gstAmt;
  if (purchaseId && extra !== 0) {
    await sb.from("purchases").update({
      total, extra_packing: packing, extra_courier: shipping, extra_adjustment: adjustment,
      gst_amount: gstAmt, gst_enabled: !!input.gst,
    }).eq("id", purchaseId).then(() => {}, () => {});
    // Keep the books in step: the RPC posted the ITEMS total to the ledger; add the extra (charges+GST).
    const { data: led } = await sb.from("ledger").select("balance").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const bal = (led as any)?.balance ?? 0;
    await sb.from("ledger").insert({ kind: "purchase", ref_id: purchaseId, debit: extra, credit: 0, balance: bal - extra, note: `Purchase charges/GST ${billNo || ""}`.trim() }).then(() => {}, () => {});
  } else if (purchaseId) {
    await sb.from("purchases").update({ gst_enabled: !!input.gst }).eq("id", purchaseId).then(() => {}, () => {});
  }

  // Payment: whatever is paid now is recorded as one supplier_payment PER method (so a bill can be
  // split across cash + upi + bank in a single purchase); anything left unpaid stays owed on the
  // supplier ledger (credit). Best-effort — a payment hiccup never unwinds the recorded stock.
  //   • NEW callers pass `payments: [{mode, amountRupees}, …]`.
  //   • Legacy callers pass a single `paymentMode` + `amountPaidRupees`; we adapt it to one leg.
  const splits: PurchasePayment[] = (input.payments?.length)
    ? input.payments
    : (input.paymentMode && input.paymentMode !== "credit")
      ? [{ mode: input.paymentMode, amountRupees: input.amountPaidRupees ?? 0 }]
      : [];
  let remaining = Number(total) || 0; // paise still available to allocate (never over-pay the bill)
  for (const s of splits) {
    if (remaining <= 0) break;
    const want = Math.max(0, Math.round((Number(s.amountRupees) || 0) * 100));
    const paise = Math.min(want, remaining);
    if (paise <= 0) continue;
    const ledgerMode = s.mode === "cash" ? "cash" : s.mode === "upi" ? "upi" : "bank";
    const { error: payErr } = await sb.from("supplier_payments").insert({
      supplier_id: input.supplierId, amount: paise, mode: ledgerMode, method_id: s.methodId || null,
      ref: billNo || null, note: `Paid at purchase${billNo ? ` · bill ${billNo}` : ""}`,
    });
    if (payErr) {
      // `method_id` column may not exist on older DBs — retry without it so the payment still saves.
      const { error: payErr2 } = await sb.from("supplier_payments").insert({
        supplier_id: input.supplierId, amount: paise, mode: ledgerMode,
        ref: billNo || null, note: `Paid at purchase${billNo ? ` · bill ${billNo}` : ""}`,
      });
      if (payErr2) console.warn("supplier payment not recorded (purchase still saved):", payErr2.message);
      else remaining -= paise;
    } else remaining -= paise;
    // Draw the money OUT of the SPECIFIC account chosen (HDFC / Kotak / SBI / UPI / Cash) so its
    // Bank & Cash balance drops — mirrors how POS records which account received a sale. Best-effort.
    if (s.methodId && purchaseId) {
      await sb.from("payment_method_transactions").insert({
        method_id: s.methodId, txn_type: "purchase", direction: "out", amount: paise,
        ref_type: "purchase", ref_id: purchaseId, note: `Purchase${billNo ? ` · bill ${billNo}` : ""}`, created_by: "owner",
      }).then(() => {}, () => {});
    }
  }
  revalidatePath("/admin/purchases"); revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/supplier/${input.supplierId}`); revalidatePath("/admin/cashbook");
  return { ok: true, total };
}

/** Lines of ONE purchase bill, with per-line returnable (bought − already returned to supplier). */
export async function fetchPurchaseForReturnAction(purchaseId: string): Promise<{ ok: boolean; error?: string; items?: { productId: string; variantId: string | null; name: string; sku: string; color: string | null; qty: number; returned: number; returnable: number; unitCost: number; backorderQty: number }[] }> {
  if (!(await requirePerm("purchases.manage"))) return { ok: false, error: "Your role can't manage purchases." };
  const id = (purchaseId ?? "").trim();
  if (!id) return { ok: false, error: "Missing purchase" };
  const sb = supabaseServer();
  const [{ data: items, error }, { data: rets }] = await Promise.all([
    sb.from("purchase_items").select("qty,unit_cost,mapped_product_id,variant_id, product:products(id,name,sku), variant:variants(id,sku,color)").eq("purchase_id", id),
    sb.from("stock_adjustments").select("product_id,variant_id,delta").eq("ref_id", id).eq("kind", "purchase_return"),
  ]);
  if (error) return { ok: false, error: error.message };

  // BACKORDER AWARENESS (client): pieces promised to OPEN backorders should not quietly leave for
  // the supplier — surface how many of each line's product/variant open backorders still need.
  const prodIds = [...new Set(((items as any[]) ?? []).map((it) => it.mapped_product_id).filter(Boolean))];
  const boBy = new Map<string, number>();
  if (prodIds.length) {
    const { data: boOrders } = await sb.from("orders").select("id").eq("is_backorder", true).neq("status", "cancelled");
    const boIds = ((boOrders as any[]) ?? []).map((o) => o.id);
    if (boIds.length) {
      const { data: boItems } = await sb.from("order_items").select("order_id,product_id,variant_id,qty").in("order_id", boIds).in("product_id", prodIds);
      for (const oi of ((boItems as any[]) ?? [])) {
        const k = `${oi.product_id}::${oi.variant_id ?? ""}`;
        boBy.set(k, (boBy.get(k) ?? 0) + (oi.qty ?? 0));
      }
    }
  }
  const retBy = new Map<string, number>();
  for (const r of ((rets as any[]) ?? [])) {
    const k = `${r.product_id}::${r.variant_id ?? ""}`;
    retBy.set(k, (retBy.get(k) ?? 0) + Math.abs(r.delta ?? 0));
  }
  return { ok: true, items: ((items as any[]) ?? []).filter((it) => it.mapped_product_id).map((it) => {
    const returned = retBy.get(`${it.mapped_product_id}::${it.variant_id ?? ""}`) ?? 0;
    const backorderQty = (boBy.get(`${it.mapped_product_id}::${it.variant_id ?? ""}`) ?? 0) + (it.variant_id ? (boBy.get(`${it.mapped_product_id}::`) ?? 0) : 0);
    return {
      productId: it.mapped_product_id, variantId: it.variant_id ?? null,
      name: it.product?.name ?? "—", sku: it.variant?.sku ?? it.product?.sku ?? "",
      color: it.variant?.color ?? null,
      qty: it.qty ?? 0, returned, returnable: Math.max(0, (it.qty ?? 0) - returned),
      unitCost: it.unit_cost ?? 0,
      /** Pieces of this product/variant still promised to OPEN backorders — warn before sending back. */
      backorderQty,
    };
  }) };
}

/** Record a PURCHASE RETURN (goods back to the supplier): variant-exact stock out + debit note.
 *  The RPC enforces the per-line cap (bought − already returned) — same rule as sales returns. */
export async function recordPurchaseReturnAction(input: { purchaseId: string; reason: string; items: { productId: string; variantId?: string | null; qty: number }[] }): Promise<{ ok: boolean; qty?: number; amount?: number; error?: string }> {
  if (!(await requirePerm("purchases.manage"))) return { ok: false, error: "Your role can't manage purchases." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Add a reason (damaged, wrong goods, excess…)" };
  const sb = supabaseServer();
  const p_items = input.items.map((i) => ({ product_id: i.productId, variant_id: i.variantId ?? null, qty: i.qty }));
  const { data, error } = await sb.rpc("record_purchase_return", { p_purchase_id: input.purchaseId, p_reason: input.reason, p_items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/purchases"); revalidatePath(`/admin/purchase/${input.purchaseId}`); revalidatePath("/admin/returns"); revalidatePath("/admin/stock-movements"); revalidatePath("/admin/catalogue"); revalidatePath("/admin/inventory"); revalidatePath("/admin/suppliers"); revalidatePath("/shop");
  return { ok: true, qty: (data as any)?.qty, amount: (data as any)?.amount };
}
