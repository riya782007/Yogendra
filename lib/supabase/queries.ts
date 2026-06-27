/** Server-only data access. Uses the service-role client (bypasses RLS for admin reads). */
import "server-only";
import { supabaseServer } from "./server";
import type { PricingFormula } from "../pricing";

/**
 * Sanitise a user search term before putting it in a PostgREST `.or(...ilike...)` filter.
 * Strips characters with meaning in the or() grammar (commas, parentheses, wildcards,
 * dots, asterisks) so a search string can never break or inject into the query.
 */
function escLike(s: string): string {
  return s.trim().replace(/[,()*%.]/g, " ").replace(/\s+/g, " ").trim();
}

export type DbCategory = { id: string; name: string; slug: string };
export type DbVariant = { id: string; color: string | null; sku: string; qty: number; image_paths: string[]; size?: string | null; polish?: string | null; wholesale_override?: number | null; retail_override?: number | null; mrp_override?: number | null };
export type DbImage = { id: string; path: string; kind: string | null; sort: number };
export type DbProduct = {
  id: string; category_id: string; sku: string; name: string;
  type: "simple" | "configurable"; base_wholesale: number; qty: number;
  status: string; generated_content: any; last_movement_at: string | null;
  subcategory_id?: string | null;
  wholesale_only?: boolean;
  wholesale_override?: number | null; retail_override?: number | null; mrp_override?: number | null;
};

export async function getPricingFormula(): Promise<PricingFormula> {
  const sb = supabaseServer();
  const { data } = await sb.from("pricing_settings").select("*").limit(1).single();
  return {
    wholesaleMarkupPct: Number(data?.wholesale_markup_pct ?? 10),
    retailMultiplier: Number(data?.retail_multiplier ?? 2.2),
    mrpMultiplier: Number(data?.mrp_multiplier ?? 2.75),
    roundToPaise: Number(data?.round_to ?? 100),
    useBuildup: Boolean(data?.use_buildup ?? false),
    shippingPct: Number(data?.shipping_pct ?? 10),
    packingPct: Number(data?.packing_pct ?? 11.36),
    promotionPct: Number(data?.promotion_pct ?? 10.2),
    resellerPct: Number(data?.reseller_pct ?? 15),
    customerDiscountPct: Number(data?.customer_discount_pct ?? 5),
    mrpPct: Number(data?.mrp_pct ?? 25),
  };
}

export async function getCategories(): Promise<DbCategory[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("categories").select("id,name,slug").order("name");
  return data ?? [];
}

// ---------- category hierarchy (subcategories) ----------
export type DbSubcategory = { id: string; category_id: string | null; name: string; slug: string; sort: number; image_style?: string };
export type CategoryNode = DbCategory & { sort?: number; subcategories: DbSubcategory[]; productCount?: number };

/** Parent categories, each with their ordered subcategories — for the management UI + filters. */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  const sb = supabaseServer();
  const [{ data: cats }, { data: subs }] = await Promise.all([
    sb.from("categories").select("id,name,slug,sort,parent_id").order("sort").order("name"),
    sb.from("subcategories").select("id,category_id,name,slug,sort,image_style").order("sort").order("name"),
  ]);
  const subList = (subs as DbSubcategory[]) ?? [];
  // Only top-level categories (parent_id null) are roots; nested categories are ignored here.
  return ((cats as any[]) ?? [])
    .filter((c) => !c.parent_id)
    .map((c) => ({
      id: c.id, name: c.name, slug: c.slug, sort: c.sort ?? 0,
      subcategories: subList.filter((s) => s.category_id === c.id),
    }));
}

/** Flat list of subcategories, optionally scoped to one parent category slug or id. */
export async function getSubcategories(opts: { categoryId?: string; categorySlug?: string } = {}): Promise<DbSubcategory[]> {
  const sb = supabaseServer();
  let categoryId = opts.categoryId;
  if (!categoryId && opts.categorySlug && opts.categorySlug !== "all") {
    const { data: cat } = await sb.from("categories").select("id").eq("slug", opts.categorySlug).maybeSingle();
    categoryId = (cat as any)?.id;
  }
  let q = sb.from("subcategories").select("id,category_id,name,slug,sort").order("sort").order("name");
  if (categoryId) q = q.eq("category_id", categoryId);
  const { data } = await q;
  return (data as DbSubcategory[]) ?? [];
}

// ---------- efficient, paginated lists (for 10k+ SKUs) ----------
export async function getProductsPage(opts: { page?: number; pageSize?: number; q?: string; category?: string; status?: string }) {
  const sb = supabaseServer();
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  let query = sb.from("products").select("id,sku,name,qty,base_wholesale,type,status,generated_content,category:categories(id,name,slug)", { count: "exact" });
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.or(`name.ilike.%${s}%,sku.ilike.%${s}%`); }
  if (opts.category && opts.category !== "all") {
    const { data: cat } = await sb.from("categories").select("id").eq("slug", opts.category).maybeSingle();
    if (cat) query = query.eq("category_id", (cat as any).id);
  }
  if (opts.status && opts.status !== "all") query = query.eq("status", opts.status);
  const fromIdx = (page - 1) * pageSize;
  const { data, count } = await query.order("sku").range(fromIdx, fromIdx + pageSize - 1);
  return { rows: (data as any[]) ?? [], total: count ?? 0, page, pageSize };
}

// ---------- shareable catalog ----------
export type CatalogCard = {
  sku: string; name: string;
  category: string; categorySlug: string;
  subcategory: string | null; subcategorySlug: string | null;
  qty: number; wholesale: number; price: number; mrp: number; offerPct: number; hasOffer: boolean;
  image: string | null; tags: string[]; keywords: string[];
  /** Owner-defined labels (Bridal, Bestseller, etc.) sourced from the labels table via product_labels. */
  labels: string[];
  /** True when the product is marked wholesale-only — hidden on the D2C shop, visible on wholesale + POS. */
  wholesaleOnly: boolean;
};

export async function getCatalogProducts(opts: { category?: string; subcategory?: string; q?: string; skus?: string[]; includeWholesaleOnly?: boolean }): Promise<CatalogCard[]> {
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  let query = sb.from("products")
    .select("id,sku,name,qty,base_wholesale,wholesale_only,wholesale_override,retail_override,mrp_override,generated_content,category:categories(name,slug),subcategory:subcategories(name,slug),images:product_images(path,kind,sort),product_labels(label_id,labels(name))")
    .eq("status", "published").order("sku");
  // Retail catalogue hides wholesale-only items; wholesale view + POS pass includeWholesaleOnly.
  if (!opts.includeWholesaleOnly) query = query.eq("wholesale_only", false);

  if (opts.category && opts.category !== "all") {
    const { data: cat } = await sb.from("categories").select("id").eq("slug", opts.category).maybeSingle();
    if (cat) query = query.eq("category_id", (cat as any).id);
  }
  // Filter to a specific subcategory via the many-to-many map (covers primary + extra subcats).
  if (opts.subcategory && opts.subcategory !== "all") {
    const { data: sub } = await sb.from("subcategories").select("id").eq("slug", opts.subcategory).maybeSingle();
    if (sub) {
      const { data: maps } = await sb.from("product_subcategory_map").select("product_id").eq("subcategory_id", (sub as any).id);
      const ids = ((maps as any[]) ?? []).map((m) => m.product_id);
      query = query.in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
  }
  // Explicit selected products → exact catalogue.
  if (opts.skus && opts.skus.length) {
    query = query.in("sku", opts.skus.map((s) => s.trim().toUpperCase()).filter(Boolean));
  }
  // Keyword search across name / SKU.
  if (opts.q && opts.q.trim()) {
    const esc = opts.q.trim().replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${esc}%,sku.ilike.%${esc}%`);
  }

  const { data } = await query;
  return ((data as any[]) ?? []).map((p): CatalogCard => {
    const ov = overridesOf(p);
    const o = _liveOffer(p.base_wholesale, formula, ov);
    const set = _resolvePrices(p.base_wholesale, formula, ov);
    const imgs = (p.images ?? []).filter((i: any) => typeof i.path === "string" && i.path.startsWith("http")).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));
    const seo = (p.generated_content as any)?.seo ?? {};
    // Labels come through the join as product_labels[{ label_id, labels: { name } }]; flatten to names.
    const labelNames = ((p.product_labels ?? []) as any[])
      .map((pl) => pl?.labels?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    return {
      sku: p.sku, name: p.name,
      category: p.category?.name ?? "", categorySlug: p.category?.slug ?? "all",
      subcategory: p.subcategory?.name ?? null, subcategorySlug: p.subcategory?.slug ?? null,
      qty: p.qty, wholesale: set.wholesaleRate, price: o.price, mrp: o.mrp, offerPct: o.offerPct, hasOffer: o.hasOffer,
      image: imgs[0]?.path ?? null,
      tags: ((p.generated_content as any)?.tags ?? []).slice(0, 6),
      keywords: (seo.keywords ?? []).slice(0, 6),
      labels: labelNames.slice(0, 6),
      wholesaleOnly: !!p.wholesale_only,
    };
  });
}

// ---------- customer directory (real customers table) ----------
export async function getCustomersDb(opts: { q?: string; type?: string }) {
  const sb = supabaseServer();
  let query = sb.from("customers").select("id,name,phone,type,gstin,city,credit_balance,created_at");
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,gstin.ilike.%${s}%`); }
  if (opts.type && opts.type !== "all") query = query.eq("type", opts.type);
  const { data } = await query.order("name");
  return (data as any[]) ?? [];
}

export async function getCustomerById(id: string) {
  const sb = supabaseServer();
  const { data: c } = await sb.from("customers").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  // Order history: linked customer_id plus any POS sales saved with the same phone.
  // (Two separate queries merged — avoids putting a raw phone into an or() filter.)
  const phone = (c as any).phone;
  const sel = "id,total,amount_paid,invoice_no,channel,bill_type,payment_mode,status,created_at,customer_id,customer_phone";
  const byId = await sb.from("orders").select(sel).eq("customer_id", id).order("created_at", { ascending: false }).limit(100);
  const byPhone = phone ? await sb.from("orders").select(sel).eq("customer_phone", phone).order("created_at", { ascending: false }).limit(100) : { data: [] as any[] };
  const seen = new Set<string>();
  const list = [...((byId.data as any[]) ?? []), ...((byPhone.data as any[]) ?? [])]
    .filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true)))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  // Pillar 8 — customer ledger view of "outstanding". Compute it from the actual orders
  // (sum of bill total - amount paid across non-cancelled orders) so partial payments and
  // unpaid invoices roll up automatically. The DB column `credit_balance` is now a
  // *manual override* (advance received, store credit, hand-entered adjustment) — kept as
  // a fallback so existing data continues to display.
  const outstandingFromOrders = list
    .filter((o: any) => o.status !== "cancelled" && o.status !== "void")
    .reduce((s: number, o: any) => s + Math.max(0, (o.total ?? 0) - (o.amount_paid ?? 0)), 0);
  return {
    customer: c,
    orders: list,
    totalSpent: list.reduce((s, o) => s + (o.total ?? 0), 0),
    orderCount: list.length,
    /** Computed: ₹ owed by this customer right now, summed across their unpaid/partially-paid bills. */
    outstanding: outstandingFromOrders,
    /** Manual override stored on the customers row — used for store credit / advance / adjustments. */
    creditAdjustment: (c as any).credit_balance ?? 0,
  };
}

export async function getSuppliersList(opts: { q?: string; kind?: string; city?: string }) {
  const sb = supabaseServer();
  let query = sb.from("suppliers").select("id,name,kind,city,state,phone,gstin,address,notes,created_at");
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,gstin.ilike.%${s}%`); }
  if (opts.kind && opts.kind !== "all") query = query.eq("kind", opts.kind);
  if (opts.city && opts.city !== "all") query = query.eq("city", opts.city);
  const { data } = await query.order("name");
  return (data as any[]) ?? [];
}
export async function getSupplierCities() {
  const sb = supabaseServer();
  const { data } = await sb.from("suppliers").select("city").not("city", "is", null);
  return Array.from(new Set(((data as any[]) ?? []).map((r) => r.city).filter(Boolean))).sort();
}

// Sortable columns for the sales/invoice register (Pillar 1 — "A–Z order of invoice").
// Token format is `<field>_<dir>`, e.g. "inv_asc". Default = newest first.
const ORDERS_SORT: Record<string, string> = { inv: "invoice_no", name: "customer_name", date: "created_at", amount: "total" };
export async function getOrdersPage(opts: { page?: number; pageSize?: number; q?: string; channel?: string; from?: string; to?: string; sort?: string }) {
  const sb = supabaseServer();
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  let query = sb.from("orders").select("id,total,amount_paid,invoice_no,channel,status,payment_mode,bill_type,customer_name,customer_phone,source_tag,created_at", { count: "exact" });
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`); }
  if (opts.channel && opts.channel !== "all") query = query.eq("channel", opts.channel);
  if (opts.from) query = query.gte("created_at", opts.from);
  if (opts.to) query = query.lte("created_at", opts.to);
  const [field, dir] = (opts.sort ?? "").split("_");
  const col = ORDERS_SORT[field] ?? "created_at";
  const asc = col === "created_at" ? dir === "asc" : dir !== "desc"; // text/amount default A→Z / low→high; date defaults newest
  const fromIdx = (page - 1) * pageSize;
  // Stable tiebreaker on created_at so equal keys keep a deterministic order.
  let q = query.order(col, { ascending: asc, nullsFirst: false });
  if (col !== "created_at") q = q.order("created_at", { ascending: false });
  const { data, count } = await q.range(fromIdx, fromIdx + pageSize - 1);
  return { rows: (data as any[]) ?? [], total: count ?? 0, page, pageSize };
}

export async function getPublishedProducts(): Promise<(DbProduct & { category: DbCategory })[]> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("products")
    .select("*, category:categories(id,name,slug)")
    .eq("status", "published")
    .order("sku");
  return (data as any) ?? [];
}

/** Customer feedback inbox (#39). */
export async function getFeedback() {
  const sb = supabaseServer();
  const { data } = await sb.from("feedback").select("*").order("created_at", { ascending: false }).limit(100);
  return (data as any[]) ?? [];
}

/** Owner-defined labels (#9/#31). */
export async function getLabels() {
  const sb = supabaseServer();
  const { data } = await sb.from("labels").select("id,name,color,sort").order("sort").order("name");
  return (data as any[]) ?? [];
}

/** Last purchase cost per product & per variant (#11/#30) — paise. */
export async function getLastPurchaseCosts(): Promise<{ byProduct: Record<string, number>; byVariant: Record<string, number> }> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("purchase_items")
    .select("mapped_product_id,variant_id,unit_cost, purchase:purchases(created_at)");
  const rows = ((data as any[]) ?? [])
    .map((r) => ({ pid: r.mapped_product_id, vid: r.variant_id, cost: r.unit_cost, at: r.purchase?.created_at ?? "" }))
    .sort((a, b) => (a.at < b.at ? 1 : -1)); // newest first
  const byProduct: Record<string, number> = {};
  const byVariant: Record<string, number> = {};
  for (const r of rows) {
    if (r.pid && byProduct[r.pid] === undefined) byProduct[r.pid] = r.cost;
    if (r.vid && byVariant[r.vid] === undefined) byVariant[r.vid] = r.cost;
  }
  return { byProduct, byVariant };
}

/** A wholesale customer's past orders (with line items) — for history + one-click reorder. */
export async function getWholesaleOrderHistory(customerId: string) {
  const sb = supabaseServer();
  const { data: orders } = await sb.from("orders")
    .select("id,total,created_at,invoice_no, order_items(qty, product:products(sku,name))")
    .eq("customer_id", customerId).eq("channel", "wholesale")
    .order("created_at", { ascending: false }).limit(20);
  return ((orders as any[]) ?? []).map((o) => ({
    id: o.id as string, total: (o.total ?? 0) as number, created_at: o.created_at as string, invoice_no: (o.invoice_no ?? null) as string | null,
    items: ((o.order_items as any[]) ?? []).map((it) => ({ sku: it.product?.sku as string, name: it.product?.name as string, qty: it.qty as number })).filter((x) => x.sku),
  }));
}

/** Supplier ledger (#36): a vendor's purchase history with running totals. */
export async function getSupplierLedger(id: string) {
  const sb = supabaseServer();
  const { data: supplier } = await sb.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (!supplier) return null;
  const [{ data: purchases }, { data: pays }] = await Promise.all([
    sb.from("purchases").select("id,bill_no,total,created_at, items:purchase_items(qty)").eq("supplier_id", id).order("created_at", { ascending: false }),
    sb.from("supplier_payments").select("id,amount,mode,ref,note,created_at").eq("supplier_id", id).order("created_at", { ascending: false }),
  ]);
  const list = ((purchases as any[]) ?? []).map((p) => ({
    id: p.id, bill_no: p.bill_no, total: p.total ?? 0, created_at: p.created_at,
    qty: ((p.items as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0),
    lines: ((p.items as any[]) ?? []).length,
  }));
  const payments = ((pays as any[]) ?? []).map((p) => ({ id: p.id, amount: p.amount ?? 0, mode: p.mode as string, ref: p.ref as string | null, note: p.note as string | null, created_at: p.created_at }));
  const opening = ((supplier as any).opening_balance ?? 0) as number;
  const totalPurchased = list.reduce((s, p) => s + p.total, 0);
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  return {
    supplier, purchases: list, payments,
    totalPurchased, totalQty: list.reduce((s, p) => s + p.qty, 0),
    opening, totalPaid,
    balanceOwed: opening + totalPurchased - totalPaid, // +ve = we still owe the supplier
  };
}

// Pillar 9 — Bank & Cash position: opening + collections in (pay_cash/pay_bank) − payments out.
export async function getCashBankBook() {
  const sb = supabaseServer();
  const { data: sum } = await sb.rpc("cash_bank_summary");
  const s: any = (Array.isArray(sum) ? sum[0] : sum) ?? {};
  const opening_cash = Number(s.opening_cash ?? 0), opening_bank = Number(s.opening_bank ?? 0);
  const cashIn = Number(s.cash_in ?? 0), bankIn = Number(s.bank_in ?? 0);
  const cashOut = Number(s.cash_out ?? 0), bankOut = Number(s.bank_out ?? 0);
  const [{ data: orders }, { data: pays }] = await Promise.all([
    sb.from("orders").select("id,invoice_no,customer_name,pay_cash,pay_bank,created_at").or("pay_cash.gt.0,pay_bank.gt.0").order("created_at", { ascending: false }).limit(80),
    sb.from("supplier_payments").select("id,supplier_id,amount,mode,note,created_at, supplier:suppliers(name)").order("created_at", { ascending: false }).limit(80),
  ]);
  const moves: any[] = [];
  for (const o of (orders as any[]) ?? []) {
    moves.push({ date: o.created_at, label: `Collection · ${o.invoice_no || String(o.id).slice(0, 6).toUpperCase()}${o.customer_name ? ` · ${o.customer_name}` : ""}`, link: `/admin/invoice/${o.id}`, cash: o.pay_cash ?? 0, bank: o.pay_bank ?? 0 });
  }
  for (const p of (pays as any[]) ?? []) {
    const isCash = p.mode === "cash";
    moves.push({ date: p.created_at, label: `Paid supplier · ${p.supplier?.name ?? ""}${p.note ? ` — ${p.note}` : ""}`, link: `/admin/supplier/${p.supplier_id}`, cash: isCash ? -(p.amount ?? 0) : 0, bank: isCash ? 0 : -(p.amount ?? 0) });
  }
  moves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return {
    opening_cash, opening_bank, cashIn, bankIn, cashOut, bankOut,
    cashBalance: opening_cash + cashIn - cashOut,
    bankBalance: opening_bank + bankIn - bankOut,
    moves: moves.slice(0, 120),
  };
}

/** Self-growing master lists for variant attributes (colour / size / polish). */
export async function getVariantOptions(): Promise<{ color: string[]; size: string[]; polish: string[] }> {
  const sb = supabaseServer();
  const { data } = await sb.from("variant_options").select("kind,value,sort").order("sort").order("value");
  const out = { color: [] as string[], size: [] as string[], polish: [] as string[] };
  for (const r of (data as any[]) ?? []) {
    const k = (r as any).kind as "color" | "size" | "polish";
    if (out[k]) out[k].push((r as any).value);
  }
  return out;
}

/** Pillar 11 — name → barcode_code lookup for the canonical colour list. Used by every
 *  auto-SKU code path (manual variant add, bulk upload, catalogue edit) so the printed
 *  barcode is consistent: BD2024-RED for a red variant, not BD2024-RED5. */
export async function getColorCodeMap(): Promise<Record<string, string>> {
  const sb = supabaseServer();
  const { data } = await sb.from("variant_options").select("value,barcode_code").eq("kind", "color");
  const out: Record<string, string> = {};
  for (const r of (data as any[]) ?? []) {
    const v = String((r as any).value ?? "").trim();
    const c = String((r as any).barcode_code ?? "").trim();
    if (v && c) out[v.toLowerCase()] = c;
  }
  return out;
}

export type OptionRow = { value: string; hex: string | null; count: number; barcode_code?: string | null };
/** Pillar 7 — the colour/size/polish master with swatch + how many variants use each. */
export async function getOptionMaster(): Promise<{ color: OptionRow[]; size: OptionRow[]; polish: OptionRow[] }> {
  const sb = supabaseServer();
  const [{ data: opts }, { data: vars }] = await Promise.all([
    sb.from("variant_options").select("kind,value,hex,sort,barcode_code").order("sort").order("value"),
    sb.from("variants").select("color,size,polish"),
  ]);
  const counts: Record<string, Record<string, number>> = { color: {}, size: {}, polish: {} };
  for (const v of (vars as any[]) ?? []) {
    for (const k of ["color", "size", "polish"] as const) {
      const val = (v as any)[k]; if (val) counts[k][val] = (counts[k][val] ?? 0) + 1;
    }
  }
  const out = { color: [] as OptionRow[], size: [] as OptionRow[], polish: [] as OptionRow[] };
  for (const r of (opts as any[]) ?? []) {
    const k = (r as any).kind as "color" | "size" | "polish";
    if (out[k]) out[k].push({
      value: (r as any).value,
      hex: (r as any).hex ?? null,
      count: counts[k][(r as any).value] ?? 0,
      barcode_code: (r as any).barcode_code ?? null,
    });
  }
  return out;
}

/** Pillar 11 — every printable label: each product AND each colour/size/polish variant
 *  (its own SKU + correctly-resolved retail price), so barcodes can be printed per piece. */
export async function getLabelItems(): Promise<{ sku: string; name: string; price: number }[]> {
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  const { data } = await sb
    .from("products")
    .select("sku,name,base_wholesale,wholesale_override,retail_override,mrp_override, variants(sku,color,size,polish,wholesale_override,retail_override,mrp_override)")
    .order("sku");
  const out: { sku: string; name: string; price: number }[] = [];
  for (const p of (data as any[]) ?? []) {
    out.push({ sku: p.sku, name: p.name, price: _resolvePrices(p.base_wholesale, formula, overridesOf(null), overridesOf(p)).retailPrice });
    for (const v of (p.variants as any[]) ?? []) {
      if (!v.sku) continue;
      const opt = [v.color, v.size, v.polish].filter(Boolean).join(" / ");
      out.push({ sku: v.sku, name: `${p.name}${opt ? ` — ${opt}` : ""}`, price: _resolvePrices(p.base_wholesale, formula, overridesOf(v), overridesOf(p)).retailPrice });
    }
  }
  return out;
}

export async function getProductBySku(sku: string): Promise<
  | (DbProduct & { category: DbCategory; variants: DbVariant[]; images: DbImage[] })
  | null
> {
  const sb = supabaseServer();
  // Rich select (subcategory + labels). If ANY embedded column/table is out of sync in the
  // deployed DB (e.g. subcategories.image_style or the product_labels table), PostgREST fails
  // the WHOLE query and returns null — which would make every storefront product page 404.
  // So we fall back to a minimal, always-valid select that still returns everything the
  // product page needs (category, variants, images). The page must never 404 a real product
  // just because an optional admin-only column drifted.
  const rich = await sb
    .from("products")
    .select("*, category:categories(id,name,slug), subcategory:subcategories(name,slug,image_style), variants(*), images:product_images(*), product_labels(label_id)")
    .eq("sku", sku)
    .maybeSingle();
  if (rich.data) return rich.data as any;

  const basic = await sb
    .from("products")
    .select("*, category:categories(id,name,slug), variants(*), images:product_images(*)")
    .eq("sku", sku)
    .maybeSingle();
  return (basic.data as any) ?? null;
}

export async function getProductSkus(): Promise<{ sku: string; slug: string }[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("sku, category:categories(slug)").eq("status", "published");
  return (data ?? []).map((r: any) => ({ sku: r.sku, slug: r.category?.slug ?? "all" }));
}

/** Recent stock movements for one product — powers the Product workspace History tab. */
export async function getStockHistory(productId: string, limit = 25): Promise<{ delta: number; source: string | null; reason: string | null; kind: string | null; ref_id: string | null; created_at: string }[]> {
  if (!productId) return [];
  const sb = supabaseServer();
  const { data } = await sb
    .from("stock_adjustments")
    .select("delta,source,reason,kind,ref_id,created_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data as any[]) ?? [];
}

// Pillar 5 — the single Stock Movement History register: every in/out across all products,
// each row carrying ref_id so its purchase/sale bill opens straight from here.
export async function getStockMovements(opts: { page?: number; pageSize?: number; kind?: string; q?: string; from?: string; to?: string }) {
  const sb = supabaseServer();
  const pageSize = opts.pageSize ?? 30;
  const page = Math.max(1, opts.page ?? 1);
  let query = sb.from("stock_adjustments")
    .select("id,delta,kind,source,reason,ref_id,sku,created_at, product:products(sku,name), variant:variants(color)", { count: "exact" });
  if (opts.kind && opts.kind !== "all") query = query.eq("kind", opts.kind);
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.ilike("sku", `%${s}%`); }
  if (opts.from) query = query.gte("created_at", opts.from);
  if (opts.to) query = query.lte("created_at", opts.to);
  const fromIdx = (page - 1) * pageSize;
  const { data, count } = await query.order("created_at", { ascending: false }).range(fromIdx, fromIdx + pageSize - 1);
  return { rows: (data as any[]) ?? [], total: count ?? 0, page, pageSize };
}

// Pillar 6 — open estimates "reserve" stock softly (not yet billed). Surface them, highlighted,
// at the top of the Stock Movement register so the owner sees what's spoken-for by live quotes.
export async function getOpenEstimateReservations(limit = 50) {
  const sb = supabaseServer();
  const { data } = await sb
    .from("estimates")
    .select("id, customer_name, created_at, estimate_items(qty, product:products(sku,name))")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? []).map((e) => ({
    id: e.id as string,
    customer_name: e.customer_name as string | null,
    created_at: e.created_at as string,
    lines: ((e.estimate_items as any[]) ?? []).map((li) => ({
      qty: li.qty as number, sku: li.product?.sku as string | undefined, name: li.product?.name as string | undefined,
    })),
    qty: ((e.estimate_items as any[]) ?? []).reduce((s, li) => s + (li.qty ?? 0), 0),
  })).filter((e) => e.lines.length > 0);
}

// ---------- dashboard + inventory intelligence (Req 6, 7; yogendra.pdf §8) ----------
import { classify, type InventoryRule, DEFAULT_RULE } from "../inventory";
import { computePrices, type PricingFormula as PF } from "../pricing";

export type DashboardData = {
  revenue: number; orders: number; cod: number; pos: number;
  cashCollected: number; bankCollected: number;
  retailers: number; pendingApprovals: number;
  totalProducts: number; newProducts: number; categories: number;
  dead: number; low: number; inactive: number; healthy: number;
  deadList: { sku: string; name: string; qty: number }[];
  lowList: { sku: string; name: string; qty: number }[];
};

export async function getDashboardData(fromISO: string, toISO: string, rule: InventoryRule = DEFAULT_RULE): Promise<DashboardData> {
  const sb = supabaseServer();
  const now = new Date();
  const [ordersRes, prodRes, catRes, retRes, apprRes] = await Promise.all([
    sb.from("orders").select("total,channel,payment_mode,pay_cash,pay_bank,created_at").gte("created_at", fromISO).lte("created_at", toISO),
    sb.from("products").select("sku,name,qty,last_movement_at,created_at,category:categories(name)"),
    sb.from("categories").select("id"),
    sb.from("retailers").select("id,approved"),
    sb.from("approvals").select("id,status"),
  ]);
  const orders = ordersRes.data ?? [];
  const products = (prodRes.data as any[]) ?? [];

  const revenue = orders.reduce((s, o: any) => s + (o.total ?? 0), 0);
  const cod = orders.filter((o: any) => o.payment_mode === "cod").length;
  const pos = orders.filter((o: any) => o.channel === "pos").length;
  const cashCollected = orders.reduce((s, o: any) => s + (o.pay_cash ?? 0), 0);
  const bankCollected = orders.reduce((s, o: any) => s + (o.pay_bank ?? 0), 0);

  const classed = products.map((p: any) => ({ ...p, cls: classify({ qty: p.qty, lastMovementAt: p.last_movement_at }, rule, now) }));
  const dead = classed.filter((p) => p.cls === "dead");
  const low = classed.filter((p) => p.cls === "low");
  const inactive = classed.filter((p) => p.cls === "inactive");
  const healthy = classed.filter((p) => p.cls === "healthy");
  const newProducts = products.filter((p: any) => p.created_at >= fromISO && p.created_at <= toISO).length;

  return {
    revenue, orders: orders.length, cod, pos, cashCollected, bankCollected,
    retailers: (retRes.data ?? []).filter((r: any) => r.approved).length,
    pendingApprovals: (apprRes.data ?? []).filter((a: any) => a.status === "pending").length,
    totalProducts: products.length, newProducts, categories: (catRes.data ?? []).length,
    dead: dead.length, low: low.length, inactive: inactive.length, healthy: healthy.length,
    deadList: dead.slice(0, 8).map((p) => ({ sku: p.sku, name: p.name, qty: p.qty })),
    lowList: low.slice(0, 8).map((p) => ({ sku: p.sku, name: p.name, qty: p.qty })),
  };
}

export type ClassifiedRow = { sku: string; name: string; category: string; categorySlug: string; status: string; qty: number; lastMovementAt: string | null; cls: string };

export async function getInventoryClassified(rule: InventoryRule = DEFAULT_RULE): Promise<ClassifiedRow[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("sku,name,qty,status,last_movement_at,category:categories(name,slug)").order("sku");
  const now = new Date();
  return ((data as any[]) ?? []).map((p) => ({
    sku: p.sku, name: p.name, category: p.category?.name ?? "—", categorySlug: p.category?.slug ?? "all",
    status: p.status, qty: p.qty, lastMovementAt: p.last_movement_at,
    cls: classify({ qty: p.qty, lastMovementAt: p.last_movement_at }, rule, now),
  }));
}

export async function getApprovals() {
  const sb = supabaseServer();
  const { data } = await sb.from("approvals").select("*").order("created_at", { ascending: false });
  return data ?? [];
}

// ---------- "Sell with us" product submissions (customers + wholesalers) ----------
export type DbProductSubmission = {
  id: string; channel: string; submitter_customer_id: string | null;
  submitter_name: string | null; submitter_phone: string | null; submitter_email: string | null;
  product_name: string; category_id: string | null; category_other: string | null;
  description: string | null; color: string | null; asking_price: number | null; qty: number;
  image_path: string | null; status: "pending" | "approved" | "rejected";
  review_note: string | null; created_product_sku: string | null;
  created_at: string; decided_at: string | null;
  category?: DbCategory | null;
};

/** All product submissions, newest first, with their (optional) category joined. */
export async function getProductSubmissions(): Promise<DbProductSubmission[]> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("product_submissions")
    .select("*, category:categories(id,name,slug)")
    .order("created_at", { ascending: false });
  return (data as DbProductSubmission[]) ?? [];
}

// ---------- storefront with ratings (premium UI) ----------
export type StoreProduct = DbProduct & {
  category: DbCategory; rating: number; reviews: number; isNew: boolean; image?: string | null;
};

export async function getStorefront(
  opts: { includeDrafts?: boolean; includeWholesaleOnly?: boolean } = {},
): Promise<{ products: StoreProduct[]; formula: PF }> {
  const sb = supabaseServer();
  // D2C-safe defaults: only published, and never wholesale-only items (#1, #23).
  let pq = sb.from("products").select("*, category:categories(id,name,slug)").order("sku");
  if (!opts.includeDrafts) pq = pq.eq("status", "published");
  const [{ data: prods }, { data: revs }, { data: pimgs }, { data: vimgs }, formula] = await Promise.all([
    pq,
    sb.from("reviews").select("product_id, rating"),
    sb.from("product_images").select("product_id, path, sort").order("sort", { ascending: true }),
    sb.from("variants").select("product_id, image_paths"),
    getPricingFormula(),
  ]);
  const agg = new Map<string, { sum: number; n: number }>();
  for (const r of (revs as any[]) ?? []) {
    const a = agg.get(r.product_id) ?? { sum: 0, n: 0 }; a.sum += r.rating; a.n++; agg.set(r.product_id, a);
  }
  // Primary thumbnail per product: first product_image (sorted, so AI "model" shot wins),
  // else the first real variant photo — so cards show the same image as the product page.
  const imgByProduct = new Map<string, string>();
  for (const r of (pimgs as any[]) ?? []) {
    if (!r.path || !String(r.path).startsWith("http")) continue;
    if (!imgByProduct.has(r.product_id)) imgByProduct.set(r.product_id, r.path);
  }
  for (const v of (vimgs as any[]) ?? []) {
    if (imgByProduct.has(v.product_id)) continue;
    const u = (((v.image_paths as string[]) ?? []).find((x) => x && x.startsWith("http")));
    if (u) imgByProduct.set(v.product_id, u);
  }
  const now = Date.now();
  let products = ((prods as any[]) ?? []).map((p) => {
    const a = agg.get(p.id);
    const rating = a && a.n ? a.sum / a.n : 4.6;
    const reviews = a?.n ?? 0;
    const isNew = p.created_at ? now - new Date(p.created_at).getTime() < 1000 * 60 * 60 * 24 * 21 : false;
    return { ...p, image: imgByProduct.get(p.id) ?? null, rating: Math.round(rating * 10) / 10, reviews, isNew };
  });
  if (!opts.includeWholesaleOnly) products = products.filter((p: any) => !p.wholesale_only);
  return { products, formula };
}

export type FeaturedReview = { id: string; author_name: string; rating: number; body: string };
export async function getFeaturedReviews(): Promise<FeaturedReview[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("reviews").select("id,author_name,rating,body").gte("rating", 4).order("created_at", { ascending: false }).limit(3);
  return ((data as any[]) ?? []).map((r) => ({ id: r.id, author_name: r.author_name, rating: r.rating, body: r.body }));
}

export type ProductReview = { id: string; author_name: string; rating: number; body: string | null; created_at: string };
export async function getProductReviews(productId: string): Promise<{ avg: number; count: number; list: ProductReview[]; dist: Record<number, number> }> {
  const sb = supabaseServer();
  const { data } = await sb.from("reviews").select("id,author_name,rating,body,created_at").eq("product_id", productId).order("created_at", { ascending: false });
  const rows = ((data as any[]) ?? []);
  const count = rows.length;
  const avg = count ? rows.reduce((s, r) => s + r.rating, 0) / count : 4.6;
  const dist: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
  for (const r of rows) dist[r.rating] = (dist[r.rating] ?? 0) + 1;
  const list = rows.filter((r) => r.body).slice(0, 6);
  return { avg: Math.round(avg * 10) / 10, count, list, dist };
}

// ---------- dashboard analytics (animated charts) ----------
export type Analytics = {
  weekly: { label: string; revenue: number }[];
  channels: { channel: string; count: number; revenue: number }[];
  categories: { name: string; revenue: number }[];
  topProducts: { name: string; revenue: number; qty: number }[];
};

export async function getDashboardAnalytics(fromISO: string, toISO: string): Promise<Analytics> {
  const sb = supabaseServer();
  const [{ data: orders }, { data: items }] = await Promise.all([
    sb.from("orders").select("total,channel,created_at").gte("created_at", fromISO).lte("created_at", toISO),
    sb.from("order_items").select("line_total,qty,order:orders(created_at,channel),product:products(name,category:categories(name))"),
  ]);
  const os = (orders as any[]) ?? [];
  const its = ((items as any[]) ?? []).filter((i) => i.order && i.order.created_at >= fromISO && i.order.created_at <= toISO);

  // weekly buckets (8)
  const weeks = 8;
  const now = new Date(toISO).getTime();
  const wk = Array.from({ length: weeks }, (_, i) => ({ label: `W${i + 1}`, revenue: 0 }));
  for (const o of os) {
    const ageDays = (now - new Date(o.created_at).getTime()) / 86400000;
    const idx = weeks - 1 - Math.min(weeks - 1, Math.floor(ageDays / 7));
    if (idx >= 0 && idx < weeks) wk[idx].revenue += o.total ?? 0;
  }

  const chMap = new Map<string, { count: number; revenue: number }>();
  for (const o of os) { const c = chMap.get(o.channel) ?? { count: 0, revenue: 0 }; c.count++; c.revenue += o.total ?? 0; chMap.set(o.channel, c); }
  const channels = ["retail", "wholesale", "pos"].map((c) => ({ channel: c, ...(chMap.get(c) ?? { count: 0, revenue: 0 }) }));

  const catMap = new Map<string, number>();
  const prodMap = new Map<string, { revenue: number; qty: number }>();
  for (const it of its) {
    const cat = it.product?.category?.name ?? "Other";
    catMap.set(cat, (catMap.get(cat) ?? 0) + (it.line_total ?? 0));
    const pn = it.product?.name ?? "—";
    const pm = prodMap.get(pn) ?? { revenue: 0, qty: 0 }; pm.revenue += it.line_total ?? 0; pm.qty += it.qty ?? 0; prodMap.set(pn, pm);
  }
  const categories = [...catMap.entries()].map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);
  const topProducts = [...prodMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  return { weekly: wk, channels, categories, topProducts };
}

/** Sales analytics for a single product (units, revenue, order count). */
export async function getProductSalesStats(sku: string) {
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,name,status,qty").eq("sku", sku).maybeSingle();
  if (!p) return null;
  const { data } = await sb.from("order_items").select("qty,line_total").eq("product_id", (p as any).id);
  const rows = (data as any[]) ?? [];
  return {
    name: (p as any).name, status: (p as any).status, stock: (p as any).qty,
    units: rows.reduce((s, r) => s + (r.qty ?? 0), 0),
    revenue: rows.reduce((s, r) => s + (r.line_total ?? 0), 0),
    orders: rows.length,
  };
}

/** Per-channel report for a date range: totals + sample order rows for the expandable view. */
export async function getChannelReport(fromISO: string, toISO: string) {
  const sb = supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,total,channel,customer_name,created_at,bill_type,payment_mode")
    .gte("created_at", fromISO).lte("created_at", toISO)
    .order("created_at", { ascending: false }).limit(1000);
  const rows = (data as any[]) ?? [];
  const channels = ["retail", "wholesale", "pos"].map((ch) => {
    const list = rows.filter((r) => r.channel === ch);
    return {
      channel: ch,
      revenue: list.reduce((s, r) => s + (r.total ?? 0), 0),
      count: list.length,
      orders: list.slice(0, 50),
    };
  });
  const grand = rows.reduce((s, r) => s + (r.total ?? 0), 0);
  return { channels, grand, count: rows.length };
}

export async function getOrder(id: string) {
  const sb = supabaseServer();
  const { data: order } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order) return null;
  const { data: items } = await sb.from("order_items").select("qty,unit_price,line_total,product:products(name,sku)").eq("order_id", id);
  return { order, items: (items as any[]) ?? [] };
}

// ---------- estimates + returns ----------
/** Estimate register. Sort whitelist mirrors the sales register so headers feel consistent.
 *  Field options: ref / customer / date / amount; direction "_asc"|"_desc". Default is newest-first. */
const ESTIMATES_SORT: Record<string, string> = {
  ref: "id",
  customer: "customer_name",
  date: "created_at",
  amount: "total",
};
export async function getEstimates(opts: { sort?: string } = {}) {
  const sb = supabaseServer();
  const [field, dir] = (opts.sort ?? "").split("_");
  const col = ESTIMATES_SORT[field] ?? "created_at";
  const asc = col === "created_at" ? dir === "asc" : dir !== "desc";
  let q = sb.from("estimates").select("id,customer_name,customer_phone,total,status,gst,order_id,notes,created_at").order(col, { ascending: asc, nullsFirst: false });
  if (col !== "created_at") q = q.order("created_at", { ascending: false });
  const { data } = await q.limit(200);
  return (data as any[]) ?? [];
}
export async function getEstimate(id: string) {
  const sb = supabaseServer();
  const { data: estimate } = await sb.from("estimates").select("*").eq("id", id).maybeSingle();
  if (!estimate) return null;
  const { data: items } = await sb.from("estimate_items").select("id,qty,unit_price,line_total,product:products(name,sku)").eq("estimate_id", id);
  return { estimate, items: (items as any[]) ?? [] };
}
export async function getRecentOrders(limit = 12) {
  const sb = supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,total,channel,payment_mode,customer_name,created_at,order_items(qty,product:products(id,name,sku))")
    .order("created_at", { ascending: false }).limit(limit);
  return (data as any[]) ?? [];
}
export async function getReturns() {
  const sb = supabaseServer();
  const { data } = await sb.from("returns").select("id,kind,reason,qty,created_at").order("created_at", { ascending: false }).limit(20);
  return (data as any[]) ?? [];
}

// ---------- purchases ----------
export async function getSuppliers() {
  const sb = supabaseServer();
  const { data } = await sb.from("suppliers").select("id,name,city").order("city");
  return (data as any[]) ?? [];
}
export async function getProductsLite() {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("id,name,sku").order("sku");
  return (data as any[]) ?? [];
}

/** Products plus their variants — for purchase entry where stock can land on a specific variant. */
export async function getProductsForPurchase() {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("id,name,sku, variants(id,sku,color,size,polish)").order("sku");
  return ((data as any[]) ?? []).map((p) => ({
    id: p.id, name: p.name, sku: p.sku,
    variants: ((p.variants as any[]) ?? []).map((v) => ({
      id: v.id, sku: v.sku,
      label: [v.color, v.size, v.polish].filter(Boolean).join(" · ") || v.sku,
    })),
  }));
}
export async function getRecentPurchases() {
  const sb = supabaseServer();
  const { data } = await sb.from("purchases")
    .select("id,bill_no,total,created_at,supplier:suppliers(name,city),purchase_items(qty)")
    .order("created_at", { ascending: false }).limit(15);
  return (data as any[]) ?? [];
}

export async function getPurchaseById(id: string) {
  const sb = supabaseServer();
  const { data: p } = await sb.from("purchases").select("*, supplier:suppliers(id,name,city)").eq("id", id).maybeSingle();
  if (!p) return null;
  const { data: items } = await sb.from("purchase_items").select("supplier_sku,qty,unit_cost, product:products(sku,name)").eq("purchase_id", id);
  const { data: pending } = await sb.from("approvals").select("id").eq("action", "delete_purchase").eq("status", "pending").contains("payload", { purchase_id: id }).maybeSingle();
  const { data: suppliers } = await sb.from("suppliers").select("id,name,city").order("name");
  return { purchase: p, items: (items as any[]) ?? [], deletionPending: !!pending, suppliers: (suppliers as any[]) ?? [] };
}

export async function searchProducts(q: string) {
  const { products, formula } = await getStorefront();
  const s = q.trim().toLowerCase();
  const results = s ? products.filter((p) => (p.name + " " + p.category.name + " " + p.sku).toLowerCase().includes(s)) : [];
  return { formula, results };
}

// ---------- RBAC ----------
export async function getRoles() {
  const sb = supabaseServer();
  const { data } = await sb.from("roles").select("id,name,permissions,passcode").order("name");
  return (data as any[]) ?? [];
}
/** Pillar — typeahead suggestions for the shareable catalogue search box.
 *  Returns published product names + SKUs, category names, and the colour master, so the
 *  owner (or a customer) can jump straight to a design / category / colour. Capped + de-duped. */
export async function getCatalogSuggestions(): Promise<{ products: { name: string; sku: string }[]; categories: { name: string; slug: string }[]; colours: string[] }> {
  const sb = supabaseServer();
  const [{ data: prods }, { data: cats }, { data: cols }] = await Promise.all([
    sb.from("products").select("name,sku,wholesale_only").eq("status", "published").eq("wholesale_only", false).order("name").limit(500),
    sb.from("categories").select("name,slug").order("name"),
    sb.from("variant_options").select("value").eq("kind", "color").order("sort").order("value"),
  ]);
  return {
    products: ((prods as any[]) ?? []).map((p) => ({ name: p.name, sku: p.sku })),
    categories: ((cats as any[]) ?? []).map((c) => ({ name: c.name, slug: c.slug })),
    colours: ((cols as any[]) ?? []).map((c) => c.value).filter(Boolean),
  };
}

// ---------- notifications / assignments ----------
export async function getNotifications() {
  const sb = supabaseServer();
  const { data } = await sb.from("notifications").select("id,subject,channel,status,deep_link,sent_at,contact:contacts(name)").order("sent_at", { ascending: false }).limit(20);
  return (data as any[]) ?? [];
}
export async function getAssignmentsRegistry() {
  const sb = supabaseServer();
  const { data } = await sb.from("assignments").select("id,responsibility,channel,sla_minutes,assignee:contacts!assignments_assigned_contact_id_fkey(name),backup:contacts!assignments_backup_contact_id_fkey(name)");
  return (data as any[]) ?? [];
}

/** Pillar — the owner-visible Activity feed. Every recorded action (product added /
 *  deleted / hidden, price changed, category changes, approvals…) from `audit_log`,
 *  newest first. Backs the "Recent activity" section on the Notifications page. */
export async function getActivityLog(limit = 60) {
  const sb = supabaseServer();
  const { data } = await sb.from("audit_log").select("id,at,actor,action,ref,detail").order("at", { ascending: false }).limit(limit);
  return (data as any[]) ?? [];
}

// ---------- CRM + abandoned carts + SEO ----------
export async function getCustomers() {
  const sb = supabaseServer();
  const { data } = await sb.from("orders").select("customer_name,customer_phone,total,created_at");
  const map = new Map<string, { name: string; phone: string | null; orders: number; spent: number; last: string }>();
  for (const o of (data as any[]) ?? []) {
    const name = (o.customer_name ?? "").trim(); if (!name) continue;
    const c = map.get(name) ?? { name, phone: o.customer_phone ?? null, orders: 0, spent: 0, last: o.created_at };
    c.orders++; c.spent += o.total ?? 0; if (o.created_at > c.last) c.last = o.created_at; if (!c.phone) c.phone = o.customer_phone ?? null;
    map.set(name, c);
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
}
export async function getRetailers() {
  const sb = supabaseServer();
  const { data } = await sb.from("retailers").select("id,name,city,approved").order("name");
  return (data as any[]) ?? [];
}
export async function getAbandonedCarts() {
  const sb = supabaseServer();
  const { data } = await sb.from("abandoned_carts").select("*").eq("recovered", false).order("created_at", { ascending: false });
  return (data as any[]) ?? [];
}
export async function getSitemapData() {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("sku, category:categories(slug)").eq("status", "published");
  const { data: cats } = await sb.from("categories").select("slug");
  return { products: ((data as any[]) ?? []).map((p) => ({ sku: p.sku, slug: p.category?.slug ?? "all" })), categories: ((cats as any[]) ?? []).map((c) => c.slug) };
}

// ---------- AI reorder agent ----------
import { classify as _classify, DEFAULT_RULE as _RULE } from "../inventory";
export type ReorderCandidate = { sku: string; name: string; category: string; qty: number; base_wholesale: number; daysSince: number | null; cls: string };
export async function getReorderCandidates(): Promise<ReorderCandidate[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("sku,name,qty,base_wholesale,last_movement_at,category:categories(name)");
  const now = new Date();
  return ((data as any[]) ?? []).map((p) => {
    const cls = _classify({ qty: p.qty, lastMovementAt: p.last_movement_at }, _RULE, now);
    const daysSince = p.last_movement_at ? Math.floor((now.getTime() - new Date(p.last_movement_at).getTime()) / 86400000) : null;
    return { sku: p.sku, name: p.name, category: p.category?.name ?? "—", qty: p.qty, base_wholesale: p.base_wholesale, daysSince, cls };
  }).filter((p) => p.cls === "low" || p.cls === "dead" || p.cls === "inactive");
}

import { cosine as _cosine } from "../ai/embeddings";
export async function getRecommendations(sku: string, n = 4): Promise<StoreProduct[]> {
  const { products } = await getStorefront();
  const sb = supabaseServer();
  const { data: embRows } = await sb.from("products").select("sku,embedding");
  const embBy = new Map<string, number[]>();
  for (const r of (embRows as any[]) ?? []) if (Array.isArray(r.embedding)) embBy.set(r.sku, r.embedding);
  const self = products.find((p) => p.sku === sku);
  if (!self) return [];
  const others = products.filter((p) => p.sku !== sku);
  const selfEmb = embBy.get(sku);
  let ranked: StoreProduct[];
  if (selfEmb && others.some((p) => embBy.has(p.sku))) {
    // Semantic when embeddings exist.
    ranked = others.filter((p) => embBy.has(p.sku))
      .map((p) => ({ p, s: _cosine(selfEmb, embBy.get(p.sku)!) }))
      .sort((a, b) => b.s - a.s).map((x) => x.p);
  } else {
    // Inventory-aware fallback (works with zero embeddings): same subcategory → same
    // category → everything else, preferring in-stock pieces. Never returns empty.
    const subId = (self as any).subcategory_id;
    const byStock = (arr: StoreProduct[]) => [...arr].sort((a, b) => (b.qty > 0 ? 1 : 0) - (a.qty > 0 ? 1 : 0));
    const sameSub = subId ? others.filter((p) => (p as any).subcategory_id === subId) : [];
    const sameCat = others.filter((p) => p.category?.slug && p.category.slug === self.category?.slug && !sameSub.some((s) => s.sku === p.sku));
    const rest = others.filter((p) => !sameSub.some((s) => s.sku === p.sku) && !sameCat.some((s) => s.sku === p.sku));
    ranked = [...byStock(sameSub), ...byStock(sameCat), ...byStock(rest)];
  }
  if (ranked.length < n) {
    const extra = others.filter((p) => !ranked.some((r) => r.sku === p.sku));
    ranked = [...ranked, ...extra];
  }
  return ranked.slice(0, n);
}

export async function getReviewsForResponse() {
  const sb = supabaseServer();
  const { data } = await sb.from("reviews").select("id,author_name,rating,body,response,product:products(name)").not("body", "is", null).order("created_at", { ascending: false }).limit(20);
  return (data as any[]) ?? [];
}

// ---------- shoppable reels ----------
import { liveOffer as _liveOffer } from "../offers";
import { resolvePrices as _resolvePrices, overridesOf } from "../pricing";
export type ReelProduct = { sku: string; name: string; price: number; categorySlug: string; category: string };
export type ShopReel = { id: string; caption: string; video_url: string | null; products: ReelProduct[] };

export async function getShoppableReels(): Promise<ShopReel[]> {
  const sb = supabaseServer();
  const [{ data }, formula] = await Promise.all([
    sb.from("reels").select("id,caption,video_url,posted_at, reel_products(product:products(sku,name,base_wholesale,status,category:categories(slug,name)))").order("posted_at", { ascending: false }),
    getPricingFormula(),
  ]);
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id, caption: r.caption, video_url: r.video_url,
    products: (r.reel_products ?? []).map((rp: any) => rp.product).filter((p: any) => p && p.status === "published")
      .map((p: any) => ({ sku: p.sku, name: p.name, price: _liveOffer(p.base_wholesale, formula).price, categorySlug: p.category?.slug ?? "all", category: p.category?.name ?? "" })),
  }));
  // NOTE: previously reels with no mapped/published products were dropped — that hid newly
  // uploaded reels. Now every reel shows; the "shop this look" chips appear only when present.
}

export async function getAdminReels() {
  const sb = supabaseServer();
  const { data } = await sb.from("reels").select("id,caption,video_url,posted_at, reel_products(product:products(sku,name))").order("posted_at", { ascending: false });
  return ((data as any[]) ?? []).map((r) => ({ id: r.id, caption: r.caption, video_url: r.video_url, products: (r.reel_products ?? []).map((rp: any) => rp.product).filter(Boolean) }));
}

// ---------- product media manager ----------
export async function getProductsWithMedia() {
  const sb = supabaseServer();
  const { data } = await sb.from("products")
    .select("id,sku,name,category:categories(name,slug), images:product_images(id,path,kind,sort)")
    .eq("status", "published").order("sku");
  return ((data as any[]) ?? []).map((p) => ({
    id: p.id, sku: p.sku, name: p.name, category: p.category?.name ?? "—", categorySlug: p.category?.slug ?? "all",
    images: (p.images ?? []).filter((i: any) => typeof i.path === "string" && i.path.startsWith("http")).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0)),
  }));
}
