"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

/** Recompute an estimate's total from its current line items. */
async function recomputeEstimateTotal(sb: ReturnType<typeof supabaseServer>, estimateId: string) {
  const { data } = await sb.from("estimate_items").select("line_total").eq("estimate_id", estimateId);
  const items = ((data as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  // Fold in the estimate's extra charges (Packing/Courier/Adjustment) so the quote total — and
  // the bill it converts to — matches the screen. Columns absent pre-migration ⇒ treated as 0.
  let charges = 0;
  const { data: est } = await sb.from("estimates").select("*").eq("id", estimateId).maybeSingle();
  if (est) {
    const e = est as any;
    // Discount comes OFF; packing/courier/TCS/adjustment go ON. Columns absent pre-migration ⇒ 0.
    charges = (e.extra_packing || 0) + (e.extra_courier || 0) + (e.extra_adjustment || 0)
            + (e.extra_tcs || 0) - (e.extra_discount || 0);
  }
  await sb.from("estimates").update({ total: Math.max(0, items + charges) }).eq("id", estimateId);
}

/** #18: edit an open estimate — customer details. */
export async function updateEstimateCustomerAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("customer_name") ?? "").trim() || null;
  const phone = String(formData.get("customer_phone") ?? "").trim() || null;
  // Buyer tax details, so a GST quotation carries the same particulars as the invoice it becomes.
  const gstin = String(formData.get("buyer_gstin") ?? "").trim().toUpperCase() || null;
  const address = String(formData.get("buyer_address") ?? "").trim() || null;
  const email = String(formData.get("buyer_email") ?? "").trim() || null;
  const shipName = String(formData.get("ship_to_name") ?? "").trim() || null;
  const shipAddr = String(formData.get("ship_to_address") ?? "").trim() || null;
  const patch: any = {
    customer_name: name, customer_phone: phone, buyer_gstin: gstin, buyer_address: address,
    buyer_email: email, ship_to_name: shipName, ship_to_address: shipAddr,
  };
  let res = await (supabaseServer().from("estimates") as any).update(patch).eq("id", id);
  if (res.error) {
    // Columns absent pre-migration — never lose the name/phone edit over the new fields.
    await supabaseServer().from("estimates").update({ customer_name: name, customer_phone: phone }).eq("id", id);
  }
  revalidatePath(`/admin/estimate/${id}`);
}

/** Discount / packing / shipping / TCS / adjustment on an open estimate. Rupees in, paise stored. */
export async function updateEstimateChargesAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const paise = (k: string) => Math.round((Number(formData.get(k) ?? 0) || 0) * 100);
  const patch: any = {
    extra_discount: Math.max(0, paise("discount")),
    extra_packing: Math.max(0, paise("packing")),
    extra_courier: Math.max(0, paise("courier")),
    extra_tcs: Math.max(0, paise("tcs")),
    extra_adjustment: paise("adjustment"),
  };
  const sb = supabaseServer();
  const res = await (sb.from("estimates") as any).update(patch).eq("id", id);
  if (!res.error) await recomputeEstimateTotal(sb, id);
  revalidatePath(`/admin/estimate/${id}`);
}

/** Choose how an estimate is quoted: with GST (inclusive/exclusive) or as a plain no-tax estimate. */
export async function setEstimateGstAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const choice = String(formData.get("tax") ?? "exclusive");   // exclusive | inclusive | none
  const patch: any = choice === "none"
    ? { gst: false }
    : { gst: true, gst_mode: choice === "inclusive" ? "inclusive" : "exclusive" };
  const res = await (supabaseServer().from("estimates") as any).update(patch).eq("id", id);
  if (res.error) await supabaseServer().from("estimates").update({ gst: choice !== "none" }).eq("id", id);
  revalidatePath(`/admin/estimate/${id}`);
}

/** #18: change a line's quantity on an open estimate. */
export async function updateEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  const qty = Math.max(1, Math.floor(Number(formData.get("qty") ?? 1)));
  if (!itemId || !estimateId) return;
  const sb = supabaseServer();
  const { data: it } = await sb.from("estimate_items").select("unit_price").eq("id", itemId).maybeSingle();
  if (!it) return;
  await sb.from("estimate_items").update({ qty, line_total: (it as any).unit_price * qty }).eq("id", itemId);
  await recomputeEstimateTotal(sb, estimateId);
  // If this estimate is ON HOLD, its stock reservation must follow the new quantity (owner changed 3→4,
  // the reserved count MUST become 4). Safe no-op when the estimate isn't held.
  await sb.rpc("resync_estimate_hold", { p_estimate_id: estimateId });
  revalidatePath(`/admin/estimate/${estimateId}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}

/** Pillar 4/15: edit a line's UNIT PRICE (₹) on an open estimate — the negotiated rate
 *  is stored and carries straight through to the final bill on conversion. */
export async function updateEstimateLinePriceAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  const rupees = Number(formData.get("price") ?? 0);
  if (!itemId || !estimateId || !Number.isFinite(rupees) || rupees < 0) return;
  const unit = Math.round(rupees * 100); // store paise
  const sb = supabaseServer();
  const { data: it } = await sb.from("estimate_items").select("qty").eq("id", itemId).maybeSingle();
  if (!it) return;
  await sb.from("estimate_items").update({ unit_price: unit, line_total: unit * (it as any).qty }).eq("id", itemId);
  await recomputeEstimateTotal(sb, estimateId);
  revalidatePath(`/admin/estimate/${estimateId}`);
}

/** #18: remove a line from an open estimate. */
export async function removeEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const itemId = String(formData.get("item_id") ?? "");
  const estimateId = String(formData.get("estimate_id") ?? "");
  if (!itemId || !estimateId) return;
  const sb = supabaseServer();
  await sb.from("estimate_items").delete().eq("id", itemId);
  await recomputeEstimateTotal(sb, estimateId);
  // Removed line → release whatever was reserved for it (no-op if the estimate isn't held).
  await sb.rpc("resync_estimate_hold", { p_estimate_id: estimateId });
  revalidatePath(`/admin/estimate/${estimateId}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}

type PosItem = { sku: string; name: string; price: number; wholesale: number; mrp: number; category: string; qty: number; parentSku?: string; parentName?: string };

/** LIVE SKU lookup for the POS counter. The billing page loads the product list once; a product the
 *  owner creates AFTER that (or on another tab) isn't in memory — so a fresh SKU "doesn't come up".
 *  This resolves any SKU straight from the database on the spot (exact variant, exact product, then a
 *  fuzzy name/SKU search) so the counter can always find and bill it without reloading. */
/**
 * LIVE stock for the exact SKUs on the bill.
 *
 * The POS holds a snapshot of the catalogue taken when the page rendered. If stock arrives afterwards
 * (a purchase entered on another tab or another laptop), that snapshot still says 0 — which made the
 * till show "out of stock" and silently flag the bill as a BACKORDER even though the goods were on the
 * shelf. Stock is therefore re-read from the database when a line is added and again before the bill
 * is placed; the snapshot is never trusted for an inventory decision.
 */
export async function posStockAction(skus: string[]): Promise<{ sku: string; qty: number }[]> {
  if (!(await requirePerm("billing.sell"))) return [];
  const list = (skus ?? []).map((s) => String(s ?? "").trim()).filter(Boolean).slice(0, 200);
  if (!list.length) return [];
  const sb = supabaseServer();
  const out = new Map<string, number>();
  // Chunked so a long bill never overflows the PostgREST URL length.
  const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
  for (const grp of chunk(list, 60)) {
    const or = grp.map((s) => `sku.ilike.${s.replace(/[,()]/g, "")}`).join(",");
    const [{ data: vs }, { data: ps }] = await Promise.all([
      sb.from("variants").select("sku,qty").or(or),
      sb.from("products").select("sku,qty").or(or),
    ]);
    // A variant SKU wins over a product SKU of the same name — that's what the barcode represents.
    for (const p of ((ps as any[]) ?? [])) out.set(String(p.sku).toUpperCase(), p.qty ?? 0);
    for (const v of ((vs as any[]) ?? [])) out.set(String(v.sku).toUpperCase(), v.qty ?? 0);
  }
  return list
    .filter((s) => out.has(s.toUpperCase()))
    .map((s) => ({ sku: s, qty: out.get(s.toUpperCase()) ?? 0 }));
}

export async function posLookupAction(rawCode: string): Promise<PosItem[]> {
  // Read-only product lookup — used by the POS billing screen AND the Estimates screen, so allow
  // either permission (a user who can raise an estimate must be able to find the product).
  if (!(await requirePerm("billing.sell")) && !(await requirePerm("estimates.create"))) return [];
  const code = (rawCode ?? "").trim();
  if (!code) return [];
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const priceOf = (base: number, vOv: any, pOv: any) => {
    const r = resolvePrices(base ?? 0, formula, vOv ?? {}, pOv ?? {});
    return { price: r.retailPrice, wholesale: r.wholesaleRate, mrp: r.mrp };
  };
  const out: PosItem[] = [];
  const seen = new Set<string>();
  const push = (it: PosItem) => { const k = it.sku.toUpperCase(); if (!seen.has(k)) { seen.add(k); out.push(it); } };

  // Load a product + its category + variants and emit POS rows (variant rows if it has colours).
  const emitProduct = (p: any) => {
    const cat = p.category?.name ?? "";
    const vs = (p.variants as any[]) ?? [];
    if (vs.length) {
      for (const v of vs) {
        const pr = priceOf(p.base_wholesale, overridesOf(v), overridesOf(p));
        push({ sku: v.sku, name: `${p.name}${v.color ? " · " + v.color : ""}`, ...pr, category: cat, qty: v.qty ?? 0, parentSku: p.sku, parentName: p.name });
      }
    } else {
      const pr = priceOf(p.base_wholesale, {}, overridesOf(p));
      push({ sku: p.sku, name: p.name, ...pr, category: cat, qty: p.qty ?? 0 });
    }
  };
  const PSEL = "id,sku,name,qty,base_wholesale,retail_override,wholesale_override,mrp_override, category:categories(name), variants(sku,color,qty,retail_override,wholesale_override,mrp_override)";

  // 1) Exact variant SKU (what's printed on the physical barcode label).
  const { data: vexact } = await sb.from("variants")
    .select("sku,color,qty,retail_override,wholesale_override,mrp_override, product:products(" + PSEL + ")")
    .ilike("sku", code).limit(1).maybeSingle();
  if (vexact && (vexact as any).product) {
    const p = (vexact as any).product; const v = vexact as any;
    const pr = priceOf(p.base_wholesale, overridesOf(v), overridesOf(p));
    push({ sku: v.sku, name: `${p.name}${v.color ? " · " + v.color : ""}`, ...pr, category: p.category?.name ?? "", qty: v.qty ?? 0, parentSku: p.sku, parentName: p.name });
    return out;
  }

  // 2) Exact product SKU (simple product, or a configurable's parent → list its colours).
  const { data: pexact } = await sb.from("products").select(PSEL).ilike("sku", code).limit(1).maybeSingle();
  if (pexact) { emitProduct(pexact); if (out.length) return out; }

  // 3) Fuzzy fallback — name / SKU contains the text (so typed searches also work live).
  const like = `%${code}%`;
  const [{ data: pmatch }, { data: vmatch }] = await Promise.all([
    sb.from("products").select(PSEL).or(`sku.ilike.${like},name.ilike.${like}`).limit(8),
    sb.from("variants").select("sku,color,qty,retail_override,wholesale_override,mrp_override, product:products(" + PSEL + ")").ilike("sku", like).limit(8),
  ]);
  for (const p of ((pmatch as any[]) ?? [])) emitProduct(p);
  for (const v of ((vmatch as any[]) ?? [])) {
    const p = (v as any).product; if (!p) continue;
    const pr = priceOf(p.base_wholesale, overridesOf(v), overridesOf(p));
    push({ sku: (v as any).sku, name: `${p.name}${(v as any).color ? " · " + (v as any).color : ""}`, ...pr, category: p.category?.name ?? "", qty: (v as any).qty ?? 0, parentSku: p.sku, parentName: p.name });
  }
  return out.slice(0, 12);
}

/** #18: add a line (by SKU, at the current retail price) to an open estimate. */
export async function addEstimateLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("estimates.create"))) return;
  const estimateId = String(formData.get("estimate_id") ?? "");
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const qty = Math.max(1, Math.floor(Number(formData.get("qty") ?? 1)));
  if (!estimateId || !sku) return;
  const sb = supabaseServer();
  // Resolve the SKU to a specific variant first (so the estimate records the exact colour),
  // then fall back to a bare product SKU.
  const { data: v } = await sb.from("variants").select("id,product_id,wholesale_override,retail_override,product:products(base_wholesale,wholesale_override,retail_override,mrp_override)").ilike("sku", sku).maybeSingle();
  let productId: string, variantId: string | null = null, base: number, ov: any;
  if (v) {
    const vp = (v as any).product;
    productId = (v as any).product_id; variantId = (v as any).id; base = vp.base_wholesale;
    ov = { wholesale_override: (v as any).wholesale_override ?? vp.wholesale_override, retail_override: (v as any).retail_override ?? vp.retail_override, mrp_override: vp.mrp_override };
  } else {
    const { data: p } = await sb.from("products").select("id,base_wholesale,wholesale_override,retail_override,mrp_override").ilike("sku", sku).maybeSingle();
    if (!p) return;
    productId = (p as any).id; base = (p as any).base_wholesale; ov = overridesOf(p);
  }
  const formula = await getPricingFormula();
  const unit = resolvePrices(base, formula, ov).retailPrice;
  await sb.from("estimate_items").insert({ estimate_id: estimateId, product_id: productId, variant_id: variantId, qty, unit_price: unit, line_total: unit * qty });
  await recomputeEstimateTotal(sb, estimateId);
  // New line on a held estimate → reserve it too (no-op if the estimate isn't held).
  await sb.rpc("resync_estimate_hold", { p_estimate_id: estimateId });
  revalidatePath(`/admin/estimate/${estimateId}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
}

/**
 * ONE-SHOT estimate save — the whole open estimate edited on a single screen and saved with one click
 * (owner: "poora bill ek saath edit ho, Vyapar jaisa"). Applies line qty/rate edits, removals, new
 * items, customer, GST and all charges together, then recomputes the total once. Replaces the old
 * scatter of per-line / per-section mini-forms.
 */
export async function saveEstimateAction(input: {
  id: string;
  lines: { id: string; qty: number; priceRupees: number }[];
  removeIds: string[];
  newItems: { sku: string; qty: number; priceRupees?: number }[];
  charges: { discount: number; packing: number; courier: number; tcs: number; adjustment: number };
  tax: "none" | "inclusive" | "exclusive";
  customer: { name?: string; phone?: string; gstin?: string; address?: string; email?: string; shipName?: string; shipAddr?: string };
}): Promise<{ ok: boolean; error?: string }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't edit estimates." };
  const id = (input.id ?? "").trim();
  if (!id) return { ok: false, error: "Missing estimate." };
  const sb = supabaseServer();

  // 1) Remove deleted lines.
  const removeIds = (input.removeIds ?? []).filter(Boolean);
  if (removeIds.length) await sb.from("estimate_items").delete().eq("estimate_id", id).in("id", removeIds);

  // 2) Update kept lines (quantity + negotiated rate).
  for (const l of input.lines ?? []) {
    if (!l?.id) continue;
    const qty = Math.max(1, Math.floor(Number(l.qty) || 1));
    const unit = Math.max(0, Math.round((Number(l.priceRupees) || 0) * 100));
    await sb.from("estimate_items").update({ qty, unit_price: unit, line_total: unit * qty }).eq("id", l.id).eq("estimate_id", id);
  }

  // 3) Add new items — resolve SKU → exact variant (colour) then parent product, price from the same
  //    formula as the counter unless the owner typed a rate.
  const formula = await getPricingFormula();
  for (const ni of input.newItems ?? []) {
    const sku = (ni?.sku ?? "").trim().toUpperCase();
    if (!sku) continue;
    const qty = Math.max(1, Math.floor(Number(ni.qty) || 1));
    const { data: v } = await sb.from("variants").select("id,product_id,wholesale_override,retail_override,product:products(base_wholesale,wholesale_override,retail_override,mrp_override)").ilike("sku", sku).maybeSingle();
    let productId: string, variantId: string | null = null, base: number, ov: any;
    if (v) {
      const vp = (v as any).product;
      productId = (v as any).product_id; variantId = (v as any).id; base = vp.base_wholesale;
      ov = { wholesale_override: (v as any).wholesale_override ?? vp.wholesale_override, retail_override: (v as any).retail_override ?? vp.retail_override, mrp_override: vp.mrp_override };
    } else {
      const { data: p } = await sb.from("products").select("id,base_wholesale,wholesale_override,retail_override,mrp_override").ilike("sku", sku).maybeSingle();
      if (!p) continue;
      productId = (p as any).id; base = (p as any).base_wholesale; ov = overridesOf(p);
    }
    const unit = (ni.priceRupees != null && Number.isFinite(ni.priceRupees) && ni.priceRupees >= 0)
      ? Math.round(ni.priceRupees * 100)
      : resolvePrices(base, formula, ov).retailPrice;
    // Merge into an existing line for the SAME product+colour instead of adding a duplicate row, so one
    // SKU is always a single consolidated line with the summed quantity (owner: same SKU was appearing
    // twice on the bill). If the line already exists we bump its qty and keep its (possibly negotiated) rate.
    let findQ = sb.from("estimate_items").select("id,qty,unit_price").eq("estimate_id", id).eq("product_id", productId).limit(1);
    findQ = variantId ? findQ.eq("variant_id", variantId) : findQ.is("variant_id", null);
    const { data: existRows } = await findQ;
    const exist = (existRows as any[])?.[0];
    if (exist) {
      const mergedQty = (exist.qty ?? 0) + qty;
      const keepUnit = (exist.unit_price ?? unit);
      await sb.from("estimate_items").update({ qty: mergedQty, unit_price: keepUnit, line_total: keepUnit * mergedQty }).eq("id", exist.id);
    } else {
      await sb.from("estimate_items").insert({ estimate_id: id, product_id: productId, variant_id: variantId, qty, unit_price: unit, line_total: unit * qty });
    }
  }

  // 4) Customer particulars.
  const c = input.customer ?? {};
  const custPatch: any = {
    customer_name: (c.name ?? "").trim() || null, customer_phone: (c.phone ?? "").trim() || null,
    buyer_gstin: (c.gstin ?? "").trim().toUpperCase() || null, buyer_address: (c.address ?? "").trim() || null,
    buyer_email: (c.email ?? "").trim() || null, ship_to_name: (c.shipName ?? "").trim() || null, ship_to_address: (c.shipAddr ?? "").trim() || null,
  };
  const cRes = await (sb.from("estimates") as any).update(custPatch).eq("id", id);
  if (cRes.error) await sb.from("estimates").update({ customer_name: custPatch.customer_name, customer_phone: custPatch.customer_phone }).eq("id", id);

  // 5) Tax treatment.
  const gstPatch: any = input.tax === "none" ? { gst: false } : { gst: true, gst_mode: input.tax === "inclusive" ? "inclusive" : "exclusive" };
  const gRes = await (sb.from("estimates") as any).update(gstPatch).eq("id", id);
  if (gRes.error) await sb.from("estimates").update({ gst: input.tax !== "none" }).eq("id", id);

  // 6) Charges (discount / packing / courier / TCS / adjustment).
  const toP = (n: number) => Math.round((Number(n) || 0) * 100);
  const chg = input.charges ?? { discount: 0, packing: 0, courier: 0, tcs: 0, adjustment: 0 };
  await (sb.from("estimates") as any).update({
    extra_discount: Math.max(0, toP(chg.discount)), extra_packing: Math.max(0, toP(chg.packing)),
    extra_courier: Math.max(0, toP(chg.courier)), extra_tcs: Math.max(0, toP(chg.tcs)), extra_adjustment: toP(chg.adjustment),
  }).eq("id", id).then(() => {}, () => {});

  await recomputeEstimateTotal(sb, id);
  // Whole-estimate save (qty edits, removals, new items) → snap the hold reservation to the new lines so
  // "Reserved" always equals what's actually on the estimate (owner: 3→4 but reserved stayed wrong).
  await sb.rpc("resync_estimate_hold", { p_estimate_id: id });
  revalidatePath(`/admin/estimate/${id}`); revalidatePath("/admin/inventory"); revalidatePath("/admin/stock-movements");
  return { ok: true };
}

export async function createEstimateAction(input: { items: { sku: string; qty: number; priceRupees?: number }[]; customer: { name?: string; phone?: string }; packingRupees?: number; courierRupees?: number; adjustmentRupees?: number; gst?: "none" | "inclusive" | "exclusive" }): Promise<{ ok: boolean; estimateId?: string; total?: number; error?: string }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't create estimates." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("create_estimate", { p_items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })), p_customer: input.customer ?? {} });
  if (error) return { ok: false, error: error.message };
  const estimateId = (data as any)?.estimate_id;
  let outTotal = (data as any)?.total as number | undefined;
  if (estimateId) {
    // Extra charges (best-effort; needs migration 0021). Adjustment may be ±.
    const xp = Math.max(0, Math.round((input.packingRupees ?? 0) * 100));
    const xc = Math.max(0, Math.round((input.courierRupees ?? 0) * 100));
    const xa = Math.round((input.adjustmentRupees ?? 0) * 100);
    const hasCharges = xp !== 0 || xc !== 0 || xa !== 0;
    if (hasCharges) {
      const { error: chErr } = await sb.from("estimates").update({ extra_packing: xp, extra_courier: xc, extra_adjustment: xa }).eq("id", estimateId);
      if (chErr) console.warn("estimate charges not saved — apply migration 0021_billing_charges.sql:", chErr.message);
    }
    // Apply the per-line rates the counter set (R/W tier or an edited rate) so the saved quote —
    // and the bill it converts to (convert uses estimate_items.unit_price) — matches the screen.
    // Match estimate_items back to the inputs by SKU.
    const priced = input.items.filter((i) => i.priceRupees != null && Number.isFinite(i.priceRupees) && (i.priceRupees as number) >= 0);
    if (priced.length) {
      const { data: its } = await sb.from("estimate_items").select("id, qty, product:products(sku), variant:variants(sku)").eq("estimate_id", estimateId);
      const bySku = new Map<string, { id: string; qty: number }>();
      for (const it of ((its as any[]) ?? [])) { const sku = (it as any).variant?.sku ?? (it as any).product?.sku; if (sku) bySku.set(String(sku).toUpperCase(), { id: it.id, qty: it.qty }); }
      for (const i of priced) {
        const m = bySku.get(i.sku.toUpperCase());
        if (!m) continue;
        const unit = Math.round((i.priceRupees as number) * 100);
        await sb.from("estimate_items").update({ unit_price: unit, line_total: unit * m.qty }).eq("id", m.id);
      }
    }
    if (priced.length || hasCharges) await recomputeEstimateTotal(sb, estimateId);
    // GST choice from the creation screen. GST is OPTIONAL — default is a plain no-tax estimate;
    // the owner turns it on (extra / included) only when the buyer needs a tax quote.
    if (input.gst === "inclusive" || input.gst === "exclusive") {
      await sb.from("estimates").update({ gst: true, gst_mode: input.gst }).eq("id", estimateId);
    } else {
      await sb.from("estimates").update({ gst: false, gst_mode: "none" }).eq("id", estimateId);
    }
    // The RPC stores only the name; persist the phone too.
    if (input.customer?.phone) await sb.from("estimates").update({ customer_phone: input.customer.phone }).eq("id", estimateId);
    const { data: est } = await sb.from("estimates").select("total").eq("id", estimateId).maybeSingle();
    if (est) outTotal = (est as any).total;
  }
  revalidatePath("/admin/estimates");
  return { ok: true, estimateId, total: outTotal };
}

export async function convertEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) return;
  const id = String(formData.get("id"));
  await supabaseServer().rpc("convert_estimate", { p_estimate_id: id });
  revalidatePath("/admin/estimates"); revalidatePath("/admin/dashboard");
}

/**
 * Bill an estimate. p_bill_type "gst" → tax invoice, "cash" → cash memo.
 * Decrements stock, posts to the ledger, links the order, then opens the bill.
 */
export async function billEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) redirect("/admin/estimates");
  const id = String(formData.get("id"));
  const billType = String(formData.get("bill_type") ?? "gst") === "cash" ? "cash" : "gst";
  const allowOversell = String(formData.get("allow_oversell") ?? "") === "1";
  const sb = supabaseServer();
  // If the estimate is ON HOLD its stock is reserved out. Release the FULL hold first, so the conversion
  // below deducts ONLY the quantity actually being billed — the untaken remainder returns to stock (the
  // "committed 50, took 20, 30 comes back" case). If the owner didn't edit it down, the same pieces just
  // convert from reserved → sold with no net change.
  const { data: estRow } = await sb.from("estimates").select("status").eq("id", id).maybeSingle();
  if ((estRow as any)?.status === "held") await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  const { data, error } = await sb.rpc("convert_estimate_v2", { p_estimate_id: id, p_bill_type: billType, p_allow_oversell: allowOversell });
  // Insufficient-stock (or any) error: bounce back to the estimate with a clear message
  // instead of throwing a server error page.
  if (error) redirect(`/admin/estimate/${id}?billerror=${encodeURIComponent(error.message)}`);
  const orderId = (data as any)?.order_id;
  if (orderId) {
    // Carry the estimate's extra charges onto the new order so the bill itemises them and GST
    // applies — order.total is recomputed as items + charges to stay authoritative.
    const { data: est } = await sb.from("estimates").select("*").eq("id", id).maybeSingle();
    // Carry the QUOTED tax treatment and buyer tax details onto the bill, so the invoice can never
    // contradict the estimate the customer already agreed to (an inclusive quote stays inclusive).
    const carry: any = {};
    const em = (est as any)?.gst_mode;
    if (billType === "gst" && (em === "inclusive" || em === "exclusive")) carry.gst_mode = em;
    if ((est as any)?.buyer_gstin) carry.buyer_gstin = (est as any).buyer_gstin;
    if ((est as any)?.buyer_address) carry.buyer_address = (est as any).buyer_address;
    if (Object.keys(carry).length) {
      const r = await (sb.from("orders") as any).update(carry).eq("id", orderId);
      if (r.error) console.warn("estimate→bill: could not carry tax details:", r.error.message);
    }
    const xp = ((est as any)?.extra_packing) || 0, xc = ((est as any)?.extra_courier) || 0;
    // Orders have no discount/TCS columns, so fold those into the order's adjustment — otherwise the
    // bill total would silently differ from the estimate the customer accepted.
    const xa = (((est as any)?.extra_adjustment) || 0) + (((est as any)?.extra_tcs) || 0) - (((est as any)?.extra_discount) || 0);
    if (xp !== 0 || xc !== 0 || xa !== 0) {
      const { data: oi } = await sb.from("order_items").select("line_total").eq("order_id", orderId);
      const itemsSum = ((oi as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
      await sb.from("orders").update({ extra_packing: xp, extra_courier: xc, extra_adjustment: xa, total: itemsSum + xp + xc + xa }).eq("id", orderId);
    }
    await sb.rpc("assign_invoice_no", { p_order: orderId });
  }
  revalidatePath("/admin/estimates"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/sales");
  if (orderId) redirect(`/admin/invoice/${orderId}`);
  redirect("/admin/estimates");
}

/** Mark an estimate as denied (customer did not want the products). If it was on hold, its reserved
 *  stock is released back to sellable first. */
export async function denyEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.deny"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id }); // safe no-op if it wasn't holding stock
  await sb.from("estimates").update({ status: "denied" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

/** Re-open a held/denied estimate. Releasing any reserved stock back to sellable (no-op if none held). */
export async function reopenEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  await sb.from("estimates").update({ status: "open" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

/** Park an estimate ON HOLD and RESERVE its stock — the committed pieces are set aside for a regular
 *  customer to collect within ~15 days (owner's real workflow). hold_estimate deducts them from sellable
 *  stock (so they can't be sold to anyone else and don't show as available) but posts NO revenue — it's
 *  not a sale yet. Billing later releases the hold and charges only the quantity actually taken; the rest
 *  returns to stock. Resume/Deny release it. Blocks (with a clear message) if stock is short. */
export async function holdEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.create"))) return;
  const id = String(formData.get("id"));
  const { error } = await supabaseServer().rpc("hold_estimate", { p_estimate_id: id });
  if (error) redirect(`/admin/estimates?holderror=${encodeURIComponent(error.message)}`);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}

/** Convert a backorder into a fulfilled sale once stock has arrived — clears the backorder flag so
 *  it drops off the Backorders list and counts as a normal completed sale. */
export async function fulfillBackorderAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  // fulfill_backorder is ALL-OR-NOTHING: it re-checks stock on every line (blocks with a clear
  // error if still short), THEN moves stock + logs the sale movements + posts revenue + releases
  // the bill into the sales record. The old flag-flip skipped all of that.
  const { error } = await supabaseServer().rpc("fulfill_backorder", { p_order_id: id });
  revalidatePath("/admin/backorders"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  if (!error) revalidateTag("storefront"); // stock moves on fulfilment → refresh the shop
  if (error) redirect(`/admin/backorders?err=${encodeURIComponent(error.message)}`);
  redirect("/admin/backorders?ok=1");
}

/** Confirm a held COD order once it's dispatched AND the customer has received/paid — re-checks stock
 *  (all-or-nothing), moves inventory, posts the sale to the ledger, marks it paid, and releases it from
 *  the COD hold so it joins the sales record. Until this, the COD order holds no stock or revenue. */
export async function confirmCodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const { error } = await supabaseServer().rpc("confirm_cod_order", { p_order_id: id });
  revalidatePath("/admin/cod"); revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard");
  if (!error) revalidateTag("storefront"); // stock finally moves here → refresh the shop so it hides if sold out
  if (error) redirect(`/admin/cod?err=${encodeURIComponent(error.message)}`);
  redirect("/admin/cod?ok=1");
}

/** Cancel a held COD order (customer refused / didn't confirm). It held NO stock and NO revenue, so we
 *  simply delete it — there is nothing to restock or reverse. */
export async function cancelCodAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const sb = supabaseServer();
  await sb.from("order_items").delete().eq("order_id", id).then(() => {}, () => {});
  await sb.from("orders").delete().eq("id", id).then(() => {}, () => {});
  revalidatePath("/admin/cod"); revalidatePath("/admin/dashboard");
  redirect("/admin/cod?cancelled=1");
}

/**
 * EDIT a line on an OPEN (pending) backorder — change its quantity or remove it. This is safe and
 * needs NO stock/ledger reconciliation: a pending backorder is held like an estimate (it hasn't moved
 * inventory or posted revenue yet), so we only touch order_items and re-total the bill. When the owner
 * later hits "Convert to sale", the corrected quantities are what move stock and post revenue.
 * (A wrong entry on a FULFILLED bill isn't editable here — that would need a return; guarded below.)
 */
export async function updateBackorderLineAction(formData: FormData): Promise<void> {
  if (!(await requirePerm("billing.sell"))) return;
  const orderId = String(formData.get("order_id") ?? "").trim();
  const itemId = String(formData.get("item_id") ?? "").trim();
  const remove = String(formData.get("remove") ?? "") === "1";
  const qty = Math.max(0, Math.floor(Number(formData.get("qty") ?? 0)));
  if (!orderId || !itemId) return;
  const sb = supabaseServer();
  // Only a PENDING backorder is editable this way (no stock/ledger to unwind).
  const { data: o } = await sb.from("orders").select("is_backorder,extra_packing,extra_courier,extra_adjustment").eq("id", orderId).maybeSingle();
  if (!(o as any)?.is_backorder) { revalidatePath("/admin/backorders"); return; }
  if (remove || qty <= 0) {
    await sb.from("order_items").delete().eq("id", itemId).eq("order_id", orderId);
  } else {
    const { data: it } = await sb.from("order_items").select("unit_price").eq("id", itemId).eq("order_id", orderId).maybeSingle();
    if (it) await sb.from("order_items").update({ qty, line_total: ((it as any).unit_price ?? 0) * qty }).eq("id", itemId);
  }
  // Re-total from the remaining lines + the bill's extra charges (packing/courier/adjustment).
  const { data: lines } = await sb.from("order_items").select("line_total").eq("order_id", orderId);
  const items = ((lines as any[]) ?? []).reduce((s, r) => s + (r.line_total ?? 0), 0);
  const charges = (((o as any).extra_packing) || 0) + (((o as any).extra_courier) || 0) + (((o as any).extra_adjustment) || 0);
  await sb.from("orders").update({ total: items + charges }).eq("id", orderId);
  revalidatePath("/admin/backorders"); revalidatePath(`/admin/invoice/${orderId}`);
}

type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; status: string; customer_name: string | null;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

/** Load a bill + its lines for the OTP-gated "edit bill" dialog. */
export async function fetchOrderForEditAction(orderId: string): Promise<{ ok: boolean; error?: string; bill?: EditableBill }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const id = (orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing bill" };
  const sb = supabaseServer();
  const { data, error } = await sb.from("orders")
    .select("id,invoice_no,total,amount_paid,is_backorder,status, order_items(id,qty,unit_price,line_total, product:products(name,sku), variant:variants(sku,color))")
    .eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Bill not found" };
  const o = data as any;
  return { ok: true, bill: {
    id: o.id, invoice_no: o.invoice_no ?? null, total: o.total ?? 0, amount_paid: o.amount_paid ?? 0,
    is_backorder: !!o.is_backorder, status: o.status ?? "",
    customer_name: o.customer_name ?? null,
    items: ((o.order_items as any[]) ?? []).map((it) => ({
      id: it.id,
      sku: (it.variant?.sku ?? it.product?.sku ?? "") as string,
      name: `${it.product?.name ?? ""}${it.variant?.color ? " · " + it.variant.color : ""}`,
      qty: it.qty ?? 0, unit_price: it.unit_price ?? 0, line_total: it.line_total ?? (it.unit_price ?? 0) * (it.qty ?? 0),
    })) } };
}

/** OTP-gated edit of ONE line on an existing bill (fix a mistake without cancelling the whole bill).
 *  The RPC keeps stock, revenue and the total correct. The owner's OTP protects it so staff can't
 *  quietly rewrite a completed sale. Set newQty=0 to remove the line. */
export async function editOrderLineAction(input: { orderId: string; itemId: string; newQty: number; otp: string }): Promise<{ ok: boolean; error?: string; total?: number; removed?: boolean }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const otp = (input.otp ?? "").trim();
  if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  const orderId = (input.orderId ?? "").trim();
  const itemId = (input.itemId ?? "").trim();
  if (!orderId || !itemId) return { ok: false, error: "Missing bill / line." };
  const newQty = Math.max(0, Math.floor(Number(input.newQty ?? 0)));
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("edit_order_line", { p_order_id: orderId, p_item_id: itemId, p_new_qty: newQty });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales"); revalidatePath("/admin/backorders"); revalidatePath("/admin/dashboard");
  return { ok: true, total: (data as any)?.total, removed: (data as any)?.removed };
}

/**
 * Add a line to an ISSUED bill — the other half of editing.
 *
 * The owner could REMOVE a wrongly-picked colour but not add the right one, so correcting a mistake
 * meant scrapping the bill and re-making it. Same OTP gate as editing, and the price is resolved
 * server-side from the live pricing formula so a corrected line is charged exactly like a fresh one.
 */
export async function addOrderLineAction(input: { orderId: string; sku: string; qty: number; priceRupees?: number; otp: string }): Promise<{ ok: boolean; error?: string; total?: number; sku?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't edit bills." };
  const otp = (input.otp ?? "").trim();
  if (!otp || otp !== OWNER_OTP()) return { ok: false, error: "Wrong OTP — ask the owner for the code." };
  const orderId = (input.orderId ?? "").trim();
  const sku = (input.sku ?? "").trim();
  if (!orderId || !sku) return { ok: false, error: "Enter the SKU to add." };
  const qty = Math.max(1, Math.floor(Number(input.qty ?? 1)));

  const sb = supabaseServer();
  const formula = await getPricingFormula();

  // Which tier this bill was raised on, so a corrected line matches the rest of the bill.
  const { data: ord } = await sb.from("orders").select("channel,bill_type").eq("id", orderId).maybeSingle();
  const wholesale = String((ord as any)?.channel ?? "").toLowerCase() === "wholesale";

  // Variant SKU first — that's what the barcode carries.
  const { data: v } = await sb.from("variants")
    .select("id,sku,product_id,retail_override,wholesale_override,mrp_override, product:products(id,sku,base_wholesale,retail_override,wholesale_override,mrp_override)")
    .ilike("sku", sku).maybeSingle();
  let productId: string | null = null, variantId: string | null = null, base = 0, vOv: any = {}, pOv: any = {};
  if (v) {
    const p = (v as any).product;
    productId = p?.id ?? (v as any).product_id; variantId = (v as any).id;
    base = p?.base_wholesale ?? 0; vOv = overridesOf(v); pOv = overridesOf(p ?? {});
  } else {
    const { data: p } = await sb.from("products")
      .select("id,sku,base_wholesale,retail_override,wholesale_override,mrp_override, variants(id,sku)")
      .ilike("sku", sku).maybeSingle();
    if (!p) return { ok: false, error: `No product “${sku}” — check the SKU.` };
    const vs = ((p as any).variants as any[]) ?? [];
    // Several colours and no colour named: refuse rather than guess which one to bill and de-stock.
    if (vs.length > 1) return { ok: false, error: `“${sku}” has ${vs.length} colours — enter the exact colour SKU (e.g. ${vs[0].sku}).` };
    productId = (p as any).id; variantId = vs.length === 1 ? vs[0].id : null;
    base = (p as any).base_wholesale ?? 0; pOv = overridesOf(p);
  }

  const pr = resolvePrices(base, formula, vOv, pOv);
  const typed = Number(input.priceRupees);
  const unitPrice = Number.isFinite(typed) && typed >= 0 ? Math.round(typed * 100) : (wholesale ? pr.wholesaleRate : pr.retailPrice);

  const { data, error } = await sb.rpc("add_order_line", {
    p_order_id: orderId, p_product_id: productId, p_variant_id: variantId,
    p_qty: qty, p_unit_price: unitPrice, p_unit_mrp: pr.mrp ?? null, p_allow_oversell: false,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/admin/invoice/${orderId}`);
  revalidatePath("/admin/sales"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/stock-movements");
  return { ok: true, total: (data as any)?.total, sku: (data as any)?.sku };
}

/** Lines of ONE order, shaped for the inline return dialog on the Sales page — so a return can be
 *  recorded straight from the bill row without hunting for it in a separate module. */
export async function fetchOrderForReturnAction(orderId: string): Promise<{ ok: boolean; error?: string; order?: { id: string; total: number; customer_name: string | null; created_at: string; items: { qty: number; returned: number; returnable: number; product: { id: string; name: string; sku: string }; variant: { sku: string; color: string | null } | null }[] } }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns." };
  const id = (orderId ?? "").trim();
  if (!id) return { ok: false, error: "Missing order" };
  const sb2 = supabaseServer();
  const { data, error } = await sb2.from("orders")
    .select("id,total,customer_name,created_at, order_items(qty, variant_id, product:products(id,name,sku), variant:variants(id,sku,color))")
    .eq("id", id).maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Order not found" };
  const o = data as any;
  // Already-returned per (product, variant) on THIS bill — summed from its return movements, so the
  // dialog can cap each line at (sold − returned) and CLOSE the window once fully returned.
  const { data: rets } = await sb2.from("stock_adjustments")
    .select("product_id,variant_id,delta").eq("ref_id", id).eq("kind", "return");
  const retBy = new Map<string, number>();
  for (const r of ((rets as any[]) ?? [])) {
    const k = `${r.product_id}::${r.variant_id ?? ""}`;
    retBy.set(k, (retBy.get(k) ?? 0) + (r.delta ?? 0));
  }
  return { ok: true, order: { id: o.id, total: o.total ?? 0, customer_name: o.customer_name ?? null, created_at: o.created_at,
    items: ((o.order_items as any[]) ?? []).map((it) => {
      const returned = retBy.get(`${it.product?.id}::${it.variant_id ?? ""}`) ?? 0;
      return { qty: it.qty ?? 0, returned, returnable: Math.max(0, (it.qty ?? 0) - returned), product: it.product, variant: it.variant ?? null };
    }) } };
}

export async function recordReturnAction(input: { orderId: string; reason: string; items: { product_id: string; variantSku?: string; qty: number }[] }): Promise<{ ok: boolean; qty?: number; error?: string; pending?: boolean }> {
  if (!(await requirePerm("billing.refund"))) return { ok: false, error: "Your role can't process returns/refunds." };
  if (!input.items?.length) return { ok: false, error: "Select items to return" };
  if (!input.reason?.trim()) return { ok: false, error: "Capture a return reason" };
  const sb = supabaseServer();

  // A sales return restocks goods and reverses money — so STAFF cannot finalise one on their own.
  // Only the owner may. A staff request is raised as an approval the owner clears with the OTP on
  // /admin/approvals; on approval the return is executed there (see decideApprovalAction).
  if (!getSession().isOwner) {
    await sb.from("approvals").insert({
      action: "sales_return",
      payload: { orderId: input.orderId, reason: input.reason, items: input.items.map((i) => ({ product_id: i.product_id, qty: i.qty, variantSku: i.variantSku ?? null })) },
      status: "pending",
      otp_hash: `h:${OWNER_OTP()}`,
    });
    revalidatePath("/admin/approvals");
    return { ok: true, pending: true };
  }

  // Variant-EXACT return: resolve each line's variantSku to its variants.id so the RPC restocks
  // the precise colour (the old code dropped variantSku — colour rows never rose, product totals
  // desynced from Σ variants, and the client's tally broke).
  const skus = [...new Set(input.items.map((i) => (i.variantSku ?? "").trim()).filter(Boolean))];
  const vBySku = new Map<string, string>();
  if (skus.length) {
    const { data: vs } = await sb.from("variants").select("id,sku").in("sku", skus);
    for (const v of ((vs as any[]) ?? [])) vBySku.set(String(v.sku).toUpperCase(), v.id);
  }
  const p_items = input.items.map((i) => ({ product_id: i.product_id, qty: i.qty, variant_id: i.variantSku ? (vBySku.get(i.variantSku.toUpperCase()) ?? null) : null }));
  const { data, error } = await sb.rpc("record_sales_return", { p_order_id: input.orderId, p_reason: input.reason, p_items });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/returns"); revalidatePath("/admin/dashboard"); revalidatePath("/admin/sales");
  revalidatePath("/admin/stock-movements"); revalidatePath("/admin/catalogue"); revalidatePath("/admin/inventory");
  revalidatePath("/admin/creditors"); revalidatePath("/shop"); revalidateTag("storefront"); revalidatePath("/admin/customers");
  return { ok: true, qty: (data as any)?.qty };
}

/**
 * Cancel a whole order (e.g. a dealer or retail COD order the customer backed out of).
 * Restocks every line, reverses the sale in the ledger, and marks the order "cancelled".
 * Money-reversing, so it is OWNER-ONLY — staff can't self-cancel.
 */
export async function cancelOrderAction(orderId: string, reason?: string): Promise<{ ok: boolean; error?: string; already?: boolean }> {
  if (!getSession().isOwner) return { ok: false, error: "Only the owner can cancel an order." };
  if (!orderId) return { ok: false, error: "Missing order." };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("cancel_order", { p_order_id: orderId, p_reason: (reason ?? "").trim() || "Cancelled" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/sales"); revalidatePath("/admin/backorders"); revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/invoice/${orderId}`);
  return { ok: true, already: !!(data as any)?.already };
}

/**
 * PAYMENT-IN from a customer (client point 16): the owner receives ₹X (cash/UPI/bank) against a
 * customer's outstanding and it auto-allocates OLDEST BILL FIRST — amount_paid rises per bill
 * (GST-inclusive receivable, net of return credits), pay_cash/pay_bank feed Bank & Cash, and the
 * customer's outstanding falls everywhere (customer page, creditors, sales status chips).
 */
/** Active payment accounts (Cash / UPI ids / banks) for the "Receive payment" account picker. */
export async function listReceiveAccountsAction(): Promise<{ id: string; name: string; kind: string; upiId: string | null; isDefault: boolean }[]> {
  const { data } = await supabaseServer().from("payment_methods").select("id,name,kind,upi_id,is_default,sort").eq("active", true).order("sort").order("name");
  return ((data as any[]) ?? []).map((m) => ({ id: m.id, name: m.name, kind: m.kind, upiId: m.upi_id ?? null, isDefault: !!m.is_default }));
}

export async function receiveCustomerPaymentAction(input: { customerId?: string | null; phone?: string | null; amountRupees: number; method: "cash" | "upi" | "bank"; methodId?: string | null; note?: string }): Promise<{ ok: boolean; allocated?: { invoice: string; paise: number }[]; leftoverPaise?: number; error?: string }> {
  if (!(await requirePerm("billing.sell"))) return { ok: false, error: "Your role can't receive payments." };
  const paise = Math.round((input.amountRupees ?? 0) * 100);
  if (!Number.isFinite(paise) || paise <= 0) return { ok: false, error: "Enter the amount received." };
  if (!input.customerId && !input.phone) return { ok: false, error: "Missing customer" };
  const sb = supabaseServer();

  // EXACT ACCOUNT the money came into (owner: "kahan aaye paise") — the owner picks a specific account
  // (Cash / a UPI id / a bank). Its `kind` decides whether it feeds Cash or Bank, and the money is logged
  // to that account's ledger + tied to each bill it settles, so the invoice can name the real account.
  const methodId = (input.methodId ?? "").trim() || null;
  let toCash = input.method === "cash";
  if (methodId) {
    const { data: pm } = await sb.from("payment_methods").select("kind").eq("id", methodId).maybeSingle();
    if (pm) toCash = String((pm as any).kind ?? "").toLowerCase() === "cash";
  }

  const sel = "id,invoice_no,total,amount_paid,bill_type,gst_mode,status,pay_cash,pay_bank,created_at";
  const byId = input.customerId ? await sb.from("orders").select(sel).eq("customer_id", input.customerId).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const byPhone = input.phone ? await sb.from("orders").select(sel).eq("customer_phone", input.phone).order("created_at", { ascending: true }).limit(200) : { data: [] as any[] };
  const seen = new Set<string>();
  const orders = [...(((byId.data as any[]) ?? [])), ...(((byPhone.data as any[]) ?? []))]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .filter((o) => o.status !== "cancelled")
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));

  const credits = await returnCreditsByOrder(orders.map((o) => o.id));
  let remaining = paise;
  const allocated: { invoice: string; paise: number }[] = [];
  for (const o of orders) {
    if (remaining <= 0) break;
    const due = orderReceivable(o, credits.get(o.id) ?? 0);
    if (due <= 0) continue;
    const alloc = Math.min(due, remaining);
    const patch: Record<string, number> = { amount_paid: (o.amount_paid ?? 0) + alloc };
    if (toCash) patch.pay_cash = (o.pay_cash ?? 0) + alloc;
    else patch.pay_bank = (o.pay_bank ?? 0) + alloc;
    const { error } = await sb.from("orders").update(patch).eq("id", o.id);
    if (error) return { ok: false, error: error.message };
    // Record the money into the CHOSEN account's ledger, tied to this bill — so the invoice names the exact
    // account and Bank & Cash stays reconciled. Best-effort (never blocks the payment).
    if (methodId) {
      await sb.from("payment_method_transactions").insert({
        method_id: methodId, txn_type: "payment", direction: "in", amount: alloc,
        ref_type: "order", ref_id: o.id, note: (input.note ?? "").trim() || null,
        created_by: "owner", occurred_at: new Date().toISOString(),
      }).then(() => {}, () => {});
    }
    allocated.push({ invoice: o.invoice_no || String(o.id).slice(0, 8).toUpperCase(), paise: alloc });
    remaining -= alloc;
  }
  if (!allocated.length) return { ok: false, error: "No outstanding bills found for this customer." };

  await sb.from("audit_log").insert({
    actor: "owner", action: "payment_in",
    ref: input.customerId ?? input.phone ?? "",
    detail: `Received ₹${Math.round(paise / 100)} (${input.method})${input.note ? ` — ${input.note}` : ""} → ${allocated.map((a) => `${a.invoice} ₹${Math.round(a.paise / 100)}`).join(", ")}${remaining > 0 ? ` · ₹${Math.round(remaining / 100)} unallocated (advance)` : ""}`,
  }).then(() => {}, () => {});

  revalidatePath("/admin/creditors"); revalidatePath("/admin/sales"); revalidatePath("/admin/customers");
  if (input.customerId) revalidatePath(`/admin/customer/${input.customerId}`);
  return { ok: true, allocated, leftoverPaise: remaining };
}
