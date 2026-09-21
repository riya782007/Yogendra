"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { orderReceivable, returnCreditsByOrder } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, getSession } from "@/lib/auth";
import { getPricingFormula } from "@/lib/supabase/queries";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { isCodOrder } from "@/lib/orderPayment";
import { recomputeEstimateTotal } from "./billing_mod_0";

const OWNER_OTP = () => process.env.OWNER_OTP ?? "482913";

/**
 * DUPLICATE QUOTES - owner (21 Sep 2026): "Yeh customer ke 4 bills ban gye h" - four identical
 * OPEN quotes for the same customer, same Rs 54,293 total, same day, each one holding stock.
 *
 * Root cause: createEstimateAction had no idempotency. Every call ran `create_estimate` and wrote a
 * brand-new quote. On a large cart this action fans out into roughly one round trip PER LINE, so it
 * can outlive the 10s function limit - the staffer sees no confirmation, presses "Save estimate"
 * again, and the attempt that looked like it failed had in fact already written a quote. Four
 * presses, four quotes, four soft holds against the same pieces of stock.
 *
 * Fix: before creating, look for a live quote from the same customer with the same cart saved in
 * the last couple of minutes; if one exists, hand that one back instead of making another. A
 * staffer who genuinely wants a second identical quote gets an explicit "save as a separate quote"
 * button, which sets allowDuplicate and skips the check - the guard can never block real work.
 *
 * The whole lookup is best-effort: any error falls through to normal creation.
 */
const DUPLICATE_WINDOW_MS = 2 * 60_000;

/** Sorted "SKUxQTY" fingerprint of a cart, repeated SKUs summed so A+A reads the same as Ax2. */
function cartFingerprint(items: { sku?: string | null; qty?: number | null }[]): string {
  const totals = new Map<string, number>();
  for (const i of items ?? []) {
    const sku = String(i?.sku ?? "").trim().toUpperCase();
    if (!sku) continue;
    totals.set(sku, (totals.get(sku) ?? 0) + Math.max(0, Math.floor(Number(i?.qty) || 0)));
  }
  return [...totals.entries()].map(([sku, qty]) => `${sku}x${qty}`).sort().join("|");
}

/** Who the quote is for, normalised so "  Akriti Verma " and "akriti verma" are one person. */
function customerFingerprint(c: { name?: string | null; phone?: string | null } | undefined): string {
  const name = String(c?.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const phone = String(c?.phone ?? "").replace(/\D/g, "").slice(-10);
  return `${name}#${phone}`;
}

/**
 * The live quote this save would duplicate, or null. Only open/held quotes count - a billed or
 * denied one is finished business, so an identical new quote for it is legitimate.
 */
async function findRecentDuplicate(
  sb: ReturnType<typeof supabaseServer>,
  items: { sku: string; qty: number }[],
  customer: { name?: string; phone?: string } | undefined,
): Promise<{ id: string; total?: number } | null> {
  try {
    const wantCart = cartFingerprint(items);
    if (!wantCart) return null;
    const wantCustomer = customerFingerprint(customer);
    const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString();

    const { data: recent, error } = await sb
      .from("estimates")
      .select("id,customer_name,customer_phone,total,created_at")
      .in("status", ["open", "held"])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !recent?.length) return null;

    const sameCustomer = ((recent as any[]) ?? []).filter(
      (e) => customerFingerprint({ name: e.customer_name, phone: e.customer_phone }) === wantCustomer,
    );
    if (!sameCustomer.length) return null;

    const { data: rows, error: itemsErr } = await sb
      .from("estimate_items")
      .select("estimate_id, qty, product:products(sku), variant:variants(sku)")
      .in("estimate_id", sameCustomer.map((e) => e.id));
    if (itemsErr) return null;

    const byEstimate = new Map<string, { sku: string; qty: number }[]>();
    for (const r of ((rows as any[]) ?? [])) {
      const sku = (r as any).variant?.sku ?? (r as any).product?.sku;
      if (!sku) continue;
      const list = byEstimate.get(r.estimate_id) ?? [];
      list.push({ sku: String(sku), qty: r.qty });
      byEstimate.set(r.estimate_id, list);
    }

    for (const e of sameCustomer) {
      const lines = byEstimate.get(e.id);
      if (lines && cartFingerprint(lines) === wantCart) return { id: e.id, total: e.total ?? undefined };
    }
    return null;
  } catch {
    return null; // the guard must never stand between the counter and a saved quote
  }
}

export async function createEstimateAction(input: { items: { sku: string; qty: number; priceRupees?: number }[]; customer: { name?: string; phone?: string }; packingRupees?: number; courierRupees?: number; adjustmentRupees?: number; gst?: "none" | "inclusive" | "exclusive"; allowDuplicate?: boolean }): Promise<{ ok: boolean; estimateId?: string; total?: number; error?: string; duplicate?: boolean }> {
  if (!(await requirePerm("estimates.create"))) return { ok: false, error: "Your role can't create estimates." };
  if (!input.items?.length) return { ok: false, error: "Add at least one item" };
  const sb = supabaseServer();
  // Idempotency: a retry of the same save must not become a second quote holding the same stock.
  if (!input.allowDuplicate) {
    const twin = await findRecentDuplicate(sb, input.items, input.customer);
    if (twin) return { ok: true, estimateId: twin.id, total: twin.total, duplicate: true };
  }
  const { data, error } = await sb.rpc("create_estimate", { p_items: input.items.map((i) => ({ sku: i.sku, qty: i.qty })), p_customer: input.customer ?? {} });
  if (error) return { ok: false, error: error.message };
  const estimateId = (data as any)?.estimate_id;
  let outTotal = (data as any)?.total as number | undefined;
  if (estimateId) {
    const xp = Math.max(0, Math.round((input.packingRupees ?? 0) * 100));
    const xc = Math.max(0, Math.round((input.courierRupees ?? 0) * 100));
    const xa = Math.round((input.adjustmentRupees ?? 0) * 100);
    const hasCharges = xp !== 0 || xc !== 0 || xa !== 0;
    const gstPatch = input.gst === "inclusive" || input.gst === "exclusive"
      ? { gst: true, gst_mode: input.gst }
      : { gst: false, gst_mode: "none" };
    /**
     * Charges, GST and phone in ONE round trip. These used to be three separate awaits late in the
     * action; together with one await per priced line they are what pushed a big cart past the 10s
     * function limit, which is what made staff press Save again and create duplicate quotes.
     * Charges must land before recomputeEstimateTotal (it reads them off the row); GST and phone do
     * not affect the total, so moving them earlier changes nothing about what is saved.
     * These columns differ between deployments, so a rejected combined patch falls back to exactly
     * the per-field updates this action did before.
     */
    const patch: Record<string, unknown> = { ...gstPatch };
    if (hasCharges) { patch.extra_packing = xp; patch.extra_courier = xc; patch.extra_adjustment = xa; }
    if (input.customer?.phone) patch.customer_phone = input.customer.phone;
    const { error: patchErr } = await sb.from("estimates").update(patch).eq("id", estimateId);
    if (patchErr) {
      if (hasCharges) {
        const { error: chErr } = await sb.from("estimates").update({ extra_packing: xp, extra_courier: xc, extra_adjustment: xa }).eq("id", estimateId);
        if (chErr) console.warn("estimate charges not saved:", chErr.message);
      }
      await sb.from("estimates").update(gstPatch).eq("id", estimateId);
      if (input.customer?.phone) await sb.from("estimates").update({ customer_phone: input.customer.phone }).eq("id", estimateId);
    }
    const priced = input.items.filter((i) => i.priceRupees != null && Number.isFinite(i.priceRupees) && (i.priceRupees as number) >= 0);
    if (priced.length) {
      const { data: its } = await sb.from("estimate_items").select("id, qty, product:products(sku), variant:variants(sku)").eq("estimate_id", estimateId);
      const bySku = new Map<string, { id: string; qty: number }>();
      for (const it of ((its as any[]) ?? [])) { const sku = (it as any).variant?.sku ?? (it as any).product?.sku; if (sku) bySku.set(String(sku).toUpperCase(), { id: it.id, qty: it.qty }); }
      // Same updates as before, one per line - but issued in small parallel batches rather than
      // strictly one after another, so wall-clock stops growing with the size of the cart. The rows
      // are independent (one per estimate_item id), so order between them never mattered.
      const jobs: (() => Promise<unknown>)[] = [];
      for (const i of priced) {
        const m = bySku.get(i.sku.toUpperCase());
        if (!m) continue;
        const unit = Math.round((i.priceRupees as number) * 100);
        jobs.push(() => sb.from("estimate_items").update({ unit_price: unit, line_total: unit * m.qty }).eq("id", m.id));
      }
      const BATCH = 8;
      for (let b = 0; b < jobs.length; b += BATCH) {
        await Promise.all(jobs.slice(b, b + BATCH).map((run) => run()));
      }
    }
    if (priced.length || hasCharges) await recomputeEstimateTotal(sb, estimateId);
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

export async function billEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.bill"))) redirect("/admin/estimates");
  const id = String(formData.get("id"));
  const billType = String(formData.get("bill_type") ?? "gst") === "cash" ? "cash" : "gst";
  const allowOversell = String(formData.get("allow_oversell") ?? "") === "1";
  const sb = supabaseServer();
  const { data: estRow } = await sb.from("estimates").select("status").eq("id", id).maybeSingle();
  if ((estRow as any)?.status === "held") await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  const { data, error } = await sb.rpc("convert_estimate_v2", { p_estimate_id: id, p_bill_type: billType, p_allow_oversell: allowOversell });
  if (error) redirect(`/admin/estimate/${id}?billerror=${encodeURIComponent(error.message)}`);
  const orderId = (data as any)?.order_id;
  if (orderId) {
    const { data: est } = await sb.from("estimates").select("*").eq("id", id).maybeSingle();
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

export async function denyEstimateAction(formData: FormData) {
  if (!(await requirePerm("estimates.deny"))) return;
  const id = String(formData.get("id"));
  const sb = supabaseServer();
  await sb.rpc("release_estimate_hold", { p_estimate_id: id });
  await sb.from("estimates").update({ status: "denied" }).eq("id", id);
  revalidatePath("/admin/estimates"); revalidatePath("/admin/stock-movements");
}
