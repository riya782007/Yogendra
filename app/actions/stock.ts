"use server";
import {revalidateTag,  revalidatePath } from "next/cache";
import { supabaseServer } from "@/lib/supabase/server";
import { requirePerm, authoritativePerms, getSession } from "@/lib/auth";
import { inferStockKind } from "@/lib/stockKind";

/**
 * Adjust stock by a signed delta, tagged with a SOURCE + typed KIND so every movement
 * is traceable. Works at PRODUCT level, or at VARIANT level when `variant_id` is given
 * (in which case the product's qty is rolled up from the sum of its variants).
 * Logged to stock_adjustments.
 */
export async function adjustStockAction(formData: FormData): Promise<void> {
  await adjustStockJsonAction(formData);
}

export type AdjustResult = { ok: boolean; error?: string; sku?: string; applied?: number; nowQty?: number };

/**
 * Same as adjustStockAction but tells the screen what happened (owner: "adjust stock ka record" — the
 * old form gave no reply, so staff couldn't tell whether it went through). Also records WHO did it.
 */
export async function adjustStockJsonAction(formData: FormData): Promise<AdjustResult> {
  // SKUs are stored upper-case; the owner often types "Bd1001". Normalise so a
  // case/spacing slip never silently no-ops ("Apply does nothing").
  const sku = String(formData.get("sku") ?? "").trim().toUpperCase();
  const variantId = String(formData.get("variant_id") ?? "").trim() || null;
  const delta = Math.trunc(Number(formData.get("delta") ?? 0));
  const source = String(formData.get("source") ?? "").trim() || "Manual adjustment";
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const kind = String(formData.get("kind") ?? "").trim() || inferStockKind(source);
  if (!sku) return { ok: false, error: "Pick a SKU first." };
  if (!delta) return { ok: false, error: "Enter a quantity." };
  // Strict: adding needs inventory.add, removing needs inventory.remove.
  if (!(await requirePerm(delta > 0 ? "inventory.add" : "inventory.remove"))) return { ok: false, error: `Your role can't ${delta > 0 ? "add" : "remove"} stock.` };
  const by = getSession().roleName || null;
  let res: AdjustResult = { ok: false, error: `SKU ${sku} was not found.` };

  const sb = supabaseServer();
  const now = new Date().toISOString();
  // Case-insensitive so a typed "Bd1001" still resolves to the stored "BD1001".
  const { data: p } = await sb.from("products").select("id,qty").ilike("sku", sku).maybeSingle();

  if (!p) {
    // Not a product SKU — it may be a VARIANT's own SKU (e.g. a scanned variant barcode
    // or a colour/size SKU typed directly). Adjust the variant and roll the product up.
    const { data: v } = await sb.from("variants").select("id,qty,product_id,sku").ilike("sku", sku).maybeSingle();
    if (!v) return res;
    const vid = (v as any).id, pid = (v as any).product_id;
    const oldQ = (v as any).qty ?? 0;
    const vNew = Math.max(0, oldQ + delta);
    const applied = vNew - oldQ;
    if (applied === 0) return { ok: false, error: `${(v as any).sku ?? sku} is already at 0 — nothing to remove.` }; // never log a phantom movement
    await sb.from("variants").update({ qty: vNew }).eq("id", vid);
    const { data: siblings } = await sb.from("variants").select("qty").eq("product_id", pid);
    const total = ((siblings as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
    await sb.from("products").update({ qty: total, last_movement_at: now }).eq("id", pid);
    await sb.from("stock_adjustments").insert({ product_id: pid, variant_id: vid, sku: (v as any).sku ?? sku, delta: applied, source, reason, kind, created_by: by });
    res = { ok: true, sku: (v as any).sku ?? sku, applied, nowQty: vNew };
  } else {
    const pid = (p as any).id;
    if (variantId) {
      // Variant-level: adjust the variant, then roll the product qty up to the variant sum.
      const { data: v } = await sb.from("variants").select("id,qty,sku").eq("id", variantId).eq("product_id", pid).maybeSingle();
      if (!v) return { ok: false, error: "That colour was not found on this product." };
      const oldQ = (v as any).qty ?? 0;
      const vNew = Math.max(0, oldQ + delta);
      const applied = vNew - oldQ;
      if (applied === 0) return { ok: false, error: "Already at 0 — nothing to remove." }; // no phantom -10 movements
      await sb.from("variants").update({ qty: vNew }).eq("id", variantId);
      const { data: siblings } = await sb.from("variants").select("qty").eq("product_id", pid);
      const total = ((siblings as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0);
      await sb.from("products").update({ qty: total, last_movement_at: now }).eq("id", pid);
      await sb.from("stock_adjustments").insert({ product_id: pid, variant_id: variantId, sku: (v as any).sku ?? sku, delta: applied, source, reason, kind, created_by: by });
      res = { ok: true, sku: (v as any).sku ?? sku, applied, nowQty: vNew };
    } else {
      const oldQ = (p as any).qty ?? 0;
      const newQty = Math.max(0, oldQ + delta);
      const applied = newQty - oldQ;
      if (applied === 0) return { ok: false, error: `${sku} is already at 0 — nothing to remove.` }; // don't log a phantom movement
      await sb.from("products").update({ qty: newQty, last_movement_at: now }).eq("id", pid);
      await sb.from("stock_adjustments").insert({ product_id: pid, sku, delta: applied, source, reason, kind, created_by: by });
      res = { ok: true, sku, applied, nowQty: newQty };
    }
  }

  revalidatePath("/admin/inventory");
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/catalogue/${sku}`);
  revalidatePath(`/admin/product/${sku}`);
  // Refresh the customer-facing shop too, otherwise a RESTOCK doesn't bring a sold-out design back online
  // (the storefront hides zero-stock designs and caches that list) — owner: "restock hone pe stock online
  // nahi ho raha". This makes a restocked design reappear on the shop at once (and a manual removal hide it).
  revalidateTag("storefront");
  return res;
}

export type MoveResult = { ok: boolean; error?: string; moved?: number; from_sku?: string; from_name?: string; from_qty?: number; to_sku?: string; to_name?: string; to_qty?: number };

/**
 * MOVE STOCK from one SKU to another (owner, Oct 2026): "WT1052 me 3 pcs hain par asli stock WT1050 ka
 * hai — remove + add ki jagah seedha move kar do, taaki staff ko Adjust stock na dena pade." The shop's
 * total never changes, so this has its own permission (inventory.move) — staff can fix a wrong SKU
 * without being able to add or remove stock. Owners / roles that can both add and remove may move too.
 * Atomic in the database (public.move_stock): both SKUs locked, a linked pair of 'move' rows logged.
 */
export async function moveStockAction(input: { from: string; to: string; qty: number; note?: string }): Promise<MoveResult> {
  const perms = await authoritativePerms();
  const allowed = perms === "*" || perms.includes("inventory.move") || (perms.includes("inventory.add") && perms.includes("inventory.remove"));
  if (!allowed) return { ok: false, error: "Your role can't move stock. Ask the owner to tick “Move stock between SKUs”." };
  const from = String(input?.from ?? "").trim().toUpperCase();
  const to = String(input?.to ?? "").trim().toUpperCase();
  const qty = Math.trunc(Number(input?.qty ?? 0));
  if (!from || !to) return { ok: false, error: "Pick both SKUs — where the stock is now, and where it should be." };
  if (from === to) return { ok: false, error: "From and To are the same SKU." };
  if (!(qty >= 1)) return { ok: false, error: "Enter how many pieces to move." };
  const sb = supabaseServer();
  const { data, error } = await sb.rpc("move_stock", {
    p_from: from, p_to: to, p_qty: qty, p_note: String(input?.note ?? "").trim() || null, p_by: getSession().roleName || null,
  });
  if (error) return { ok: false, error: error.message || "Couldn't move the stock." };
  const r = (data ?? {}) as any;
  revalidatePath("/admin/inventory");
  revalidatePath("/admin/stock-movements");
  revalidatePath("/admin/dashboard");
  revalidateTag("storefront");
  return { ok: true, ...r };
}

/** Live stock of one SKU (colour SKU or simple product) for the Move-stock form. */
export async function skuStockAction(raw: string): Promise<{ sku: string; name: string; qty: number; colours?: number } | null> {
  const sku = String(raw ?? "").trim();
  if (!sku) return null;
  if (!(await requirePerm("inventory.view"))) return null;
  const sb = supabaseServer();
  const { data: v } = await sb.from("variants").select("sku,qty,color,product:products(name)").ilike("sku", sku).maybeSingle();
  if (v) return { sku: (v as any).sku, name: [(v as any).product?.name, (v as any).color].filter(Boolean).join(" · "), qty: (v as any).qty ?? 0 };
  const { data: p } = await sb.from("products").select("id,sku,name,qty").ilike("sku", sku).maybeSingle();
  if (!p) return null;
  const { count } = await sb.from("variants").select("id", { count: "exact", head: true }).eq("product_id", (p as any).id);
  return { sku: (p as any).sku, name: (p as any).name ?? "", qty: (p as any).qty ?? 0, colours: count ?? 0 };
}

/**
 * BULK OPENING-STOCK IMPORT — bring the owner's old-software stock into this system in one go.
 * Each row is { sku, qty } where qty is the ABSOLUTE stock the item should have. We resolve the SKU
 * to a variant (its own SKU) or a simple product, SET its stock to that number, log the change as an
 * "opening" movement (so the ledger stays honest), and roll each product's qty up from its variants.
 * Efficient (maps loaded once, chunked writes) so a full catalogue import doesn't time out.
 */
export async function bulkSetStockAction(
  rows: { sku: string; qty: number }[],
): Promise<{ ok: boolean; updated?: number; unchanged?: number; notFound?: number; notFoundSkus?: string[]; error?: string }> {
  if (!(await requirePerm("inventory.add"))) return { ok: false, error: "Your role can't update stock." };
  const clean = (rows ?? [])
    .map((r) => ({ sku: String(r.sku ?? "").trim().toUpperCase(), qty: Math.max(0, Math.trunc(Number(r.qty))) }))
    .filter((r) => r.sku && Number.isFinite(r.qty));
  if (!clean.length) return { ok: false, error: "No valid rows (need columns: sku, qty)." };
  if (clean.length > 20000) return { ok: false, error: "Too many rows at once — split into files of ≤ 20,000." };

  const sb = supabaseServer();
  // Load ALL variants + products once (paged past the 1000-row cap).
  const varBySku = new Map<string, { id: string; product_id: string; qty: number }>();
  const varsByProduct = new Map<string, { id: string; qty: number }[]>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("variants").select("id,product_id,sku,qty").order("id").range(from, from + 999);
    const arr = (data as any[]) ?? [];
    for (const v of arr) {
      const rec = { id: v.id as string, product_id: v.product_id as string, qty: (v.qty ?? 0) as number };
      if (v.sku) varBySku.set(String(v.sku).toUpperCase(), rec);
      const list = varsByProduct.get(v.product_id) ?? []; list.push(rec); varsByProduct.set(v.product_id, list);
    }
    if (arr.length < 1000) break;
  }
  const prodBySku = new Map<string, { id: string; qty: number }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("products").select("id,sku,qty").order("id").range(from, from + 999);
    const arr = (data as any[]) ?? [];
    for (const p of arr) if (p.sku) prodBySku.set(String(p.sku).toUpperCase(), { id: p.id as string, qty: (p.qty ?? 0) as number });
    if (arr.length < 1000) break;
  }

  const now = new Date().toISOString();
  const variantUpdates: { id: string; qty: number }[] = [];
  const productDirect: { id: string; qty: number }[] = [];
  const adjustments: any[] = [];
  const affectedProducts = new Set<string>();
  let unchanged = 0;
  const notFoundSkus: string[] = [];

  for (const r of clean) {
    const v = varBySku.get(r.sku);
    if (v) {
      if (v.qty === r.qty) { unchanged++; continue; }
      adjustments.push({ product_id: v.product_id, variant_id: v.id, sku: r.sku, delta: r.qty - v.qty, source: "Opening stock (import)", reason: "Bulk stock import from old system", kind: "opening" });
      v.qty = r.qty; // mutate in-memory so the product roll-up below is correct
      variantUpdates.push({ id: v.id, qty: r.qty });
      affectedProducts.add(v.product_id);
      continue;
    }
    const p = prodBySku.get(r.sku);
    if (p && !varsByProduct.has(p.id)) {
      if (p.qty === r.qty) { unchanged++; continue; }
      adjustments.push({ product_id: p.id, sku: r.sku, delta: r.qty - p.qty, source: "Opening stock (import)", reason: "Bulk stock import from old system", kind: "opening" });
      productDirect.push({ id: p.id, qty: r.qty });
      continue;
    }
    notFoundSkus.push(r.sku);
  }

  const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
  // Apply variant qty sets.
  for (const grp of chunk(variantUpdates, 80)) await Promise.all(grp.map((u) => sb.from("variants").update({ qty: u.qty }).eq("id", u.id)));
  // Simple-product qty sets.
  for (const grp of chunk(productDirect, 80)) await Promise.all(grp.map((u) => sb.from("products").update({ qty: u.qty, last_movement_at: now }).eq("id", u.id)));
  // Roll each affected product's qty up from its (now-updated) variants.
  const rollups = [...affectedProducts].map((pid) => ({ id: pid, qty: (varsByProduct.get(pid) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0) }));
  for (const grp of chunk(rollups, 80)) await Promise.all(grp.map((u) => sb.from("products").update({ qty: u.qty, last_movement_at: now }).eq("id", u.id)));
  // Log every movement (chunked bulk insert). Never silently drop a ledger row: retry once on
  // failure so stock can't move without being recorded. (The DB reconciler self-heals any residue.)
  for (const grp of chunk(adjustments, 500)) {
    const { error } = await sb.from("stock_adjustments").insert(grp);
    if (error) { const r = await sb.from("stock_adjustments").insert(grp); if (r.error) console.error("stock_adjustments insert failed (bulk import):", r.error.message); }
  }

  revalidatePath("/admin/inventory"); revalidatePath("/admin/catalogue"); revalidatePath("/admin/dashboard"); revalidatePath("/shop"); revalidateTag("storefront");
  return { ok: true, updated: variantUpdates.length + productDirect.length, unchanged, notFound: notFoundSkus.length, notFoundSkus: notFoundSkus.slice(0, 50) };
}
