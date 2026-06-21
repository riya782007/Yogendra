/** Server-only data access. Uses the service-role client (bypasses RLS for admin reads). */
import "server-only";
import { supabaseServer } from "./server";
import type { PricingFormula } from "../pricing";

export type DbCategory = { id: string; name: string; slug: string };
export type DbVariant = { id: string; color: string | null; sku: string; qty: number; image_paths: string[] };
export type DbImage = { id: string; path: string; kind: string | null; sort: number };
export type DbProduct = {
  id: string; category_id: string; sku: string; name: string;
  type: "simple" | "configurable"; base_wholesale: number; qty: number;
  status: string; generated_content: any; last_movement_at: string | null;
};

export async function getPricingFormula(): Promise<PricingFormula> {
  const sb = supabaseServer();
  const { data } = await sb.from("pricing_settings").select("*").limit(1).single();
  return {
    wholesaleMarkupPct: Number(data?.wholesale_markup_pct ?? 10),
    retailMultiplier: Number(data?.retail_multiplier ?? 2.2),
    mrpMultiplier: Number(data?.mrp_multiplier ?? 2.75),
    roundToPaise: Number(data?.round_to ?? 100),
  };
}

export async function getCategories(): Promise<DbCategory[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("categories").select("id,name,slug").order("name");
  return data ?? [];
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

export async function getProductBySku(sku: string): Promise<
  | (DbProduct & { category: DbCategory; variants: DbVariant[]; images: DbImage[] })
  | null
> {
  const sb = supabaseServer();
  const { data } = await sb
    .from("products")
    .select("*, category:categories(id,name,slug), variants(*), images:product_images(*)")
    .eq("sku", sku)
    .maybeSingle();
  return (data as any) ?? null;
}

export async function getProductSkus(): Promise<{ sku: string; slug: string }[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("sku, category:categories(slug)").eq("status", "published");
  return (data ?? []).map((r: any) => ({ sku: r.sku, slug: r.category?.slug ?? "all" }));
}

// ---------- dashboard + inventory intelligence (Req 6, 7; yogendra.pdf §8) ----------
import { classify, type InventoryRule, DEFAULT_RULE } from "../inventory";
import { computePrices, type PricingFormula as PF } from "../pricing";

export type DashboardData = {
  revenue: number; orders: number; cod: number; pos: number;
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
    sb.from("orders").select("total,channel,payment_mode,created_at").gte("created_at", fromISO).lte("created_at", toISO),
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

  const classed = products.map((p: any) => ({ ...p, cls: classify({ qty: p.qty, lastMovementAt: p.last_movement_at }, rule, now) }));
  const dead = classed.filter((p) => p.cls === "dead");
  const low = classed.filter((p) => p.cls === "low");
  const inactive = classed.filter((p) => p.cls === "inactive");
  const healthy = classed.filter((p) => p.cls === "healthy");
  const newProducts = products.filter((p: any) => p.created_at >= fromISO && p.created_at <= toISO).length;

  return {
    revenue, orders: orders.length, cod, pos,
    retailers: (retRes.data ?? []).filter((r: any) => r.approved).length,
    pendingApprovals: (apprRes.data ?? []).filter((a: any) => a.status === "pending").length,
    totalProducts: products.length, newProducts, categories: (catRes.data ?? []).length,
    dead: dead.length, low: low.length, inactive: inactive.length, healthy: healthy.length,
    deadList: dead.slice(0, 8).map((p) => ({ sku: p.sku, name: p.name, qty: p.qty })),
    lowList: low.slice(0, 8).map((p) => ({ sku: p.sku, name: p.name, qty: p.qty })),
  };
}

export type ClassifiedRow = { sku: string; name: string; category: string; qty: number; lastMovementAt: string | null; cls: string };

export async function getInventoryClassified(rule: InventoryRule = DEFAULT_RULE): Promise<ClassifiedRow[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("products").select("sku,name,qty,last_movement_at,category:categories(name)").order("sku");
  const now = new Date();
  return ((data as any[]) ?? []).map((p) => ({
    sku: p.sku, name: p.name, category: p.category?.name ?? "—", qty: p.qty, lastMovementAt: p.last_movement_at,
    cls: classify({ qty: p.qty, lastMovementAt: p.last_movement_at }, rule, now),
  }));
}

export async function getApprovals() {
  const sb = supabaseServer();
  const { data } = await sb.from("approvals").select("*").order("created_at", { ascending: false });
  return data ?? [];
}

// ---------- storefront with ratings (premium UI) ----------
export type StoreProduct = DbProduct & {
  category: DbCategory; rating: number; reviews: number; isNew: boolean;
};

export async function getStorefront(): Promise<{ products: StoreProduct[]; formula: PF }> {
  const sb = supabaseServer();
  const [{ data: prods }, { data: revs }, formula] = await Promise.all([
    sb.from("products").select("*, category:categories(id,name,slug)").eq("status", "published").order("sku"),
    sb.from("reviews").select("product_id, rating"),
    getPricingFormula(),
  ]);
  const agg = new Map<string, { sum: number; n: number }>();
  for (const r of (revs as any[]) ?? []) {
    const a = agg.get(r.product_id) ?? { sum: 0, n: 0 }; a.sum += r.rating; a.n++; agg.set(r.product_id, a);
  }
  const now = Date.now();
  const products = ((prods as any[]) ?? []).map((p) => {
    const a = agg.get(p.id);
    const rating = a && a.n ? a.sum / a.n : 4.6;
    const reviews = a?.n ?? 0;
    const isNew = p.created_at ? now - new Date(p.created_at).getTime() < 1000 * 60 * 60 * 24 * 21 : false;
    return { ...p, rating: Math.round(rating * 10) / 10, reviews, isNew };
  });
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

export async function getOrder(id: string) {
  const sb = supabaseServer();
  const { data: order } = await sb.from("orders").select("*").eq("id", id).maybeSingle();
  if (!order) return null;
  const { data: items } = await sb.from("order_items").select("qty,unit_price,line_total,product:products(name,sku)").eq("order_id", id);
  return { order, items: (items as any[]) ?? [] };
}

// ---------- estimates + returns ----------
export async function getEstimates() {
  const sb = supabaseServer();
  const { data } = await sb.from("estimates").select("id,customer_name,total,status,created_at").order("created_at", { ascending: false }).limit(30);
  return (data as any[]) ?? [];
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
export async function getRecentPurchases() {
  const sb = supabaseServer();
  const { data } = await sb.from("purchases")
    .select("id,bill_no,total,created_at,supplier:suppliers(name,city),purchase_items(qty)")
    .order("created_at", { ascending: false }).limit(15);
  return (data as any[]) ?? [];
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
  const { data } = await sb.from("roles").select("id,name,permissions").order("name");
  return (data as any[]) ?? [];
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
