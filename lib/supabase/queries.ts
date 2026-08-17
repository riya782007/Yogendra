/** Server-only data access. Uses the service-role client (bypasses RLS for admin reads). */
import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseServer } from "./server";
import type { PricingFormula } from "../pricing";
import { cleanTiers } from "../pricing";
import {
  isWalkInPlaceholder, phoneLast10, directoryNameKey, billGrandPaise, isLiveSale, directoryIdsForOrder,
} from "../customerSpend";

export { isWalkInPlaceholder, phoneLast10, directoryNameKey, billGrandPaise };

/**
 * PostgREST caps every select at 1000 rows (the `max-rows` default). With a 4000+ product
 * catalogue that silently truncates lists, counts and the storefront. `fetchAll` pages through
 * in 1000-row windows and returns the complete set. `build(from,to)` must construct a FRESH
 * query each call (query builders are single-use) and apply `.range(from,to)`.
 */
async function fetchAll<T = any>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const step = 1000; const out: T[] = [];
  for (let from = 0; ; from += step) {
    const { data } = await build(from, from + step - 1);
    const rows = (data as T[]) ?? [];
    out.push(...rows);
    if (rows.length < step) break;
  }
  return out;
}

/** Run an `.in(col, ids)` lookup in safe chunks — a long id list would otherwise blow past the URL length limit. */
async function fetchByIds<T = any>(ids: string[], build: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await build(ids.slice(i, i + 200));
    out.push(...((data as T[]) ?? []));
  }
  return out;
}

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

/**
 * The storefront must show ONLY AI-generated images, never the owner's raw upload. Raw photos are
 * stored with kind 'source'/'flatlay' and are kept (the "Fix a detail" editor needs them as the
 * true-design reference), so every customer-facing image read filters them out through this guard.
 * Generated images (kind 'model','angle','hero', branded, or legacy null) always pass.
 */
const STOREFRONT_HIDDEN_IMAGE_KINDS = new Set(["source", "flatlay"]);
export function isStorefrontImage(kind?: string | null): boolean {
  return !STOREFRONT_HIDDEN_IMAGE_KINDS.has((kind ?? "").toLowerCase());
}
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
    packingFlat: Number(data?.packing_flat ?? 2500),      // paise, flat ₹25 default
    promotionFlat: Number(data?.promotion_flat ?? 2500),  // paise, flat ₹25 default
    resellerPct: Number(data?.reseller_pct ?? 15),
    customerDiscountPct: Number(data?.customer_discount_pct ?? 5),
    mrpPct: Number(data?.mrp_pct ?? 25),
    wholesaleMinOrder: Number(data?.wholesale_min_order ?? 300000),
    wholesaleTiers: cleanTiers(data?.wholesale_tiers),
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

/** Styles = the second taxonomy dimension (Choker, Long Necklace…). Resilient: returns [] until
 *  migration 0032 creates the table, so callers never break before it's applied. */
export async function getStyles(opts: { categoryId?: string } = {}): Promise<{ id: string; name: string; slug: string; category_id: string | null }[]> {
  const sb = supabaseServer();
  let q = sb.from("styles").select("id,name,slug,category_id,sort").order("sort").order("name");
  if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
  const { data, error } = await q;
  if (error) return [];
  return ((data as any[]) ?? []).map((s) => ({ id: s.id, name: s.name, slug: s.slug, category_id: s.category_id ?? null }));
}

// ---------- efficient, paginated lists (for 10k+ SKUs) ----------
export async function getProductsPage(opts: { page?: number; pageSize?: number; q?: string; category?: string; subcategory?: string; status?: string; stock?: string }) {
  const sb = supabaseServer();
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  let query = sb.from("products").select("id,sku,name,qty,base_wholesale,type,status,generated_content,admin_tags,thumbnail_path,default_variant_id,more_designs,category:categories(id,name,slug)", { count: "exact" });
  // Tokenised search: every WORD the owner typed must appear (in the name OR the sku), in ANY order.
  // A single contiguous ilike missed "prisha gold watch" for "Prisha Floral Design Gold Watch" (the words
  // aren't adjacent) — owner: "Prisha gold watch nhi hai". Each token is a separate OR group, and multiple
  // .or() calls are ANDed, so all words must match.
  if (opts.q?.trim()) {
    for (const tok of opts.q.trim().split(/\s+/)) {
      const t = escLike(tok);
      if (t) query = query.or(`name.ilike.%${t}%,sku.ilike.%${t}%`);
    }
  }
  if (opts.category && opts.category !== "all") {
    const { data: cat } = await sb.from("categories").select("id").eq("slug", opts.category).maybeSingle();
    if (cat) query = query.eq("category_id", (cat as any).id);
  }
  // Subcategory filter — resolve the slug to its id and match on the product's primary subcategory.
  if (opts.subcategory && opts.subcategory !== "all") {
    const { data: sub } = await sb.from("subcategories").select("id").eq("slug", opts.subcategory).maybeSingle();
    if (sub) query = query.eq("subcategory_id", (sub as any).id);
  }
  if (opts.status && opts.status !== "all") query = query.eq("status", opts.status);
  // Stock filter — products.qty is kept in sync with the variant sum (resyncProductQty), so this is accurate.
  if (opts.stock === "in") query = query.gt("qty", 0);
  else if (opts.stock === "out") query = query.lte("qty", 0);
  const fromIdx = (page - 1) * pageSize;
  // IN-STOCK designs on top, OUT-OF-STOCK pushed to the very end (owner's efficiency request) — done
  // at the DB level so it holds across pages. Within each group, newest-created shows first
  // ("jo last product bana wo upar dikhe"); sku is a stable tiebreaker. When the owner explicitly
  // filters by stock, the group sort is a no-op, so newest-first still applies.
  const { data, count } = await query
    .order("in_stock", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("sku", { ascending: false })
    .range(fromIdx, fromIdx + pageSize - 1);
  const rows = (data as any[]) ?? [];
  // Attach a thumbnail (first real photo) per product so the catalogue list shows real images and
  // can flag drafts that still need one. Fetched separately so a bad embed can't blank the list.
  const ids = rows.map((r) => r.id);
  for (const r of rows) r.variants = [];
  if (ids.length) {
    const [{ data: imgs }, { data: vrows }] = await Promise.all([
      sb.from("product_images").select("product_id,path,sort").in("product_id", ids).order("sort", { ascending: true }),
      sb.from("variants").select("id,product_id,sku,color,qty,image_paths").in("product_id", ids),
    ]);
    const byP = new Map<string, string>();
    for (const im of ((imgs as any[]) ?? [])) {
      if (!im.path || !String(im.path).startsWith("http")) continue;
      if (!byP.has(im.product_id)) byP.set(im.product_id, im.path);
    }
    // Fall back to a VARIANT's photo when the product itself has none — a piece may have been shot
    // per-colour (variant image) without a product-level hero, and the catalogue should still show it.
    const vImgByP = new Map<string, string>();       // first variant photo (any colour)
    const vImgInStock = new Map<string, string>();    // first IN-STOCK colour's photo
    const varImgSet = new Map<string, Set<string>>();
    const inStockImgSet = new Map<string, Set<string>>();
    const varById = new Map<string, { qty: number; img: string | null }>(); // for the DEFAULT colour
    const addTo = (m: Map<string, Set<string>>, pid: string, u: string) => { let s = m.get(pid); if (!s) { s = new Set(); m.set(pid, s); } s.add(u); };
    const vByP = new Map<string, { sku: string; color: string | null; qty: number }[]>();
    for (const v of ((vrows as any[]) ?? [])) {
      const a = vByP.get(v.product_id) ?? [];
      a.push({ sku: v.sku, color: v.color ?? null, qty: v.qty ?? 0 });
      vByP.set(v.product_id, a);
      const paths = Array.isArray(v.image_paths) ? (v.image_paths as string[]).filter((x) => typeof x === "string" && x.startsWith("http")) : [];
      for (const u of paths) { addTo(varImgSet, v.product_id, u); if ((v.qty ?? 0) > 0) addTo(inStockImgSet, v.product_id, u); }
      const hit = paths[0];
      varById.set(v.id, { qty: v.qty ?? 0, img: hit ?? null });
      if (hit) {
        if (!vImgByP.has(v.product_id)) vImgByP.set(v.product_id, hit);
        if ((v.qty ?? 0) > 0 && !vImgInStock.has(v.product_id)) vImgInStock.set(v.product_id, hit);
      }
    }
    // Show the SAME picture the storefront shows: the owner's DEFAULT colour's lead photo first (if in
    // stock), then a valid non-sold-out thumbnail, then an in-stock colour. So the catalogue image always
    // matches the storefront default.
    for (const r of rows) {
      const dv = r.default_variant_id ? varById.get(r.default_variant_id) : undefined;
      const defImg = (dv && dv.qty > 0 && dv.img) ? dv.img : null;
      const tp = (typeof r.thumbnail_path === "string" && r.thumbnail_path.startsWith("http")) ? r.thumbnail_path : null;
      const tpOosColour = !!tp && (varImgSet.get(r.id)?.has(tp) ?? false) && !(inStockImgSet.get(r.id)?.has(tp) ?? false);
      const cover = defImg ?? ((tp && !tpOosColour) ? tp : null);
      r.image = cover ?? byP.get(r.id) ?? vImgInStock.get(r.id) ?? vImgByP.get(r.id) ?? null;
      r.variants = vByP.get(r.id) ?? [];
    }
  }
  return { rows, total: count ?? 0, page, pageSize };
}

// ---------- shareable catalog ----------
export type CatalogCard = {
  sku: string; name: string;
  category: string; categorySlug: string;
  subcategory: string | null; subcategorySlug: string | null;
  /** Trade (wholesale) rate in paise. OPTIONAL by design: it is ONLY populated when the
   *  caller explicitly passes includeWholesalePricing (i.e. an authenticated dealer/admin).
   *  For retail responses the field is absent from the JSON entirely — never just hidden. */
  wholesale?: number;
  qty: number; price: number; mrp: number; offerPct: number; hasOffer: boolean;
  image: string | null; tags: string[]; keywords: string[];
  /** Owner-defined labels (Bridal, Bestseller, etc.) sourced from the labels table via product_labels. */
  labels: string[];
  /** True when the product is marked wholesale-only — hidden on the D2C shop, visible on wholesale + POS. */
  wholesaleOnly: boolean;
  /** In-stock colour variants this design comes in — shown as chips on the shared-catalogue card. */
  colors: string[];
};

export async function getCatalogProducts(opts: { category?: string; subcategory?: string; style?: string; q?: string; skus?: string[]; includeWholesaleOnly?: boolean; excludeRetailOnly?: boolean; includeWholesalePricing?: boolean; inStock?: boolean }): Promise<CatalogCard[]> {
  const sb = supabaseServer();
  const formula = await getPricingFormula();

  // Resolve category + subcategory filters up-front so the SAME filters apply to either select.
  let catId: string | null = null;
  if (opts.category && opts.category !== "all") {
    const { data: cat } = await sb.from("categories").select("id").eq("slug", opts.category).maybeSingle();
    catId = (cat as any)?.id ?? null;
  }
  let subIds: string[] | null = null;
  if (opts.subcategory && opts.subcategory !== "all") {
    const { data: sub } = await sb.from("subcategories").select("id").eq("slug", opts.subcategory).maybeSingle();
    if (sub) {
      const { data: maps } = await sb.from("product_subcategory_map").select("product_id").eq("subcategory_id", (sub as any).id);
      subIds = ((maps as any[]) ?? []).map((m) => m.product_id);
      if (subIds.length === 0) subIds = ["00000000-0000-0000-0000-000000000000"];
    }
  }
  // Style filter (2nd dimension). Resilient: if the styles table isn't there yet, skip silently.
  let styleId: string | null = null;
  if (opts.style && opts.style !== "all") {
    let sq = sb.from("styles").select("id").eq("slug", opts.style);
    if (catId) sq = sq.eq("category_id", catId);
    const { data: st, error: se } = await sq.maybeSingle();
    if (!se) styleId = (st as any)?.id ?? "00000000-0000-0000-0000-000000000000";
  }

  const build = (sel: string) => {
    let q = sb.from("products").select(sel).eq("status", "published").order("sku");
    if (!opts.includeWholesaleOnly) q = q.eq("wholesale_only", false); // retail hides wholesale-only
    if (opts.excludeRetailOnly) q = q.eq("retail_only", false);        // wholesale hides retail-only
    // Shareable catalogue never shows sold-out designs — products.qty is the variant-sum (kept in
    // sync by resyncProductQty), so qty>0 means at least one colour is in stock. Skip this filter when
    // the owner has hand-picked specific SKUs to share (respect his explicit selection).
    if (opts.inStock && !(opts.skus && opts.skus.length)) q = q.gt("qty", 0);
    if (catId) q = q.eq("category_id", catId);
    if (subIds) q = q.in("id", subIds);
    if (styleId) q = q.eq("style_id", styleId);
    if (opts.skus && opts.skus.length) q = q.in("sku", opts.skus.map((s) => s.trim().toUpperCase()).filter(Boolean));
    if (opts.q && opts.q.trim()) { const esc = opts.q.trim().replace(/[%,()]/g, " "); q = q.or(`name.ilike.%${esc}%,sku.ilike.%${esc}%`); }
    return q;
  };

  // RICH carries subcategory name + label chips. If ANY embedded relation is out of sync in the
  // deployed DB, PostgREST fails the WHOLE query and returns null — which blanks the whole catalogue
  // (the bug). So fall back to a BASIC select (core fields + category + images) that cannot fail.
  // Same resilience pattern as getProductBySku.
  const RICH = "id,sku,name,qty,base_wholesale,wholesale_only,retail_only,wholesale_override,retail_override,mrp_override,generated_content,thumbnail_path,category:categories(name,slug),subcategory:subcategories(name,slug),images:product_images(path,kind,sort),product_labels(label_id,labels(name))";
  const BASIC = "id,sku,name,qty,base_wholesale,wholesale_only,retail_only,wholesale_override,retail_override,mrp_override,generated_content,category:categories(name,slug)";

  // A single category can exceed PostgREST's 1000-row cap, so page through the results.
  const firstRich = await build(RICH).range(0, 999);
  let data: any[] | null;
  if (firstRich.error || firstRich.data == null) {
    data = null;
  } else {
    data = [...(firstRich.data as any[])];
    for (let from = 1000; data.length === from; from += 1000) {
      const nx = await build(RICH).range(from, from + 999);
      const rows = (nx.data as any[]) ?? [];
      data.push(...rows);
      if (rows.length < 1000) break;
    }
  }
  if (data == null) {
    // Rich embed failed → fetch the proven-safe minimal set (core + category, exactly what the
    // working storefront query uses), then attach images in a SEPARATE query so that no single
    // embedded relation (subcategory / labels / images) can ever blank the whole catalogue.
    data = await fetchAll((f, t) => build(BASIC).range(f, t));
    const rows = data as any[];
    const ids = rows.map((p) => (p as any).id);
    if (ids.length) {
      const imgs = await fetchByIds(ids, (chunk) => sb.from("product_images").select("product_id,path,sort").in("product_id", chunk));
      const byP = new Map<string, any[]>();
      for (const im of (imgs as any[])) { const a = byP.get(im.product_id) ?? []; a.push(im); byP.set(im.product_id, a); }
      for (const p of rows) (p as any).images = byP.get((p as any).id) ?? [];
    }
  }
  // Variant-image fallback: a piece may only have per-colour (variant) photos and no product-level
  // hero — the card should still show an image instead of a blank tile.
  const cardRows = (data as any[]) ?? [];
  const vImgByP = new Map<string, string>();
  // Colours a design comes in, IN STOCK only — so the shared catalogue card can show colour chips
  // (owner: "catalog me variant nahi dikh raha"). Same variant fetch that already resolves cover images.
  const colorsByP = new Map<string, Set<string>>();
  const cardIds = cardRows.map((p) => p.id).filter(Boolean);
  if (cardIds.length) {
    const vimgs = await fetchByIds(cardIds, (chunk) => sb.from("variants").select("product_id,image_paths,color,qty").in("product_id", chunk));
    for (const v of ((vimgs as any[]) ?? [])) {
      if (!vImgByP.has(v.product_id) && Array.isArray(v.image_paths)) {
        const hit = v.image_paths.find((x: string) => typeof x === "string" && x.startsWith("http"));
        if (hit) vImgByP.set(v.product_id, hit);
      }
      const c = String(v.color ?? "").trim();
      if (c && (v.qty ?? 0) > 0) {
        let s = colorsByP.get(v.product_id); if (!s) { s = new Set(); colorsByP.set(v.product_id, s); } s.add(c);
      }
    }
  }
  return cardRows.map((p): CatalogCard => {
    const ov = overridesOf(p);
    const o = _liveOffer(p.base_wholesale, formula, ov);
    const set = _resolvePrices(p.base_wholesale, formula, ov);
    const imgs = (p.images ?? []).filter((i: any) => typeof i.path === "string" && i.path.startsWith("http") && isStorefrontImage(i.kind)).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));
    const seo = (p.generated_content as any)?.seo ?? {};
    // Labels come through the join as product_labels[{ label_id, labels: { name } }]; flatten to names.
    const labelNames = ((p.product_labels ?? []) as any[])
      .map((pl) => pl?.labels?.name)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    return {
      sku: p.sku, name: p.name,
      category: p.category?.name ?? "", categorySlug: p.category?.slug ?? "all",
      subcategory: p.subcategory?.name ?? null, subcategorySlug: p.subcategory?.slug ?? null,
      // Trade price is emitted ONLY for authorised callers; omitted from retail JSON entirely.
      ...(opts.includeWholesalePricing ? { wholesale: set.wholesaleRate } : {}),
      qty: p.qty, price: o.price, mrp: o.mrp, offerPct: o.offerPct, hasOffer: o.hasOffer,
      // Owner-chosen cover wins; else first generated image; else a variant photo.
      image: (typeof p.thumbnail_path === "string" && p.thumbnail_path.startsWith("http") ? p.thumbnail_path : null) ?? imgs[0]?.path ?? vImgByP.get(p.id) ?? null,
      tags: ((p.generated_content as any)?.tags ?? []).slice(0, 6),
      keywords: (seo.keywords ?? []).slice(0, 6),
      labels: labelNames.slice(0, 6),
      wholesaleOnly: !!p.wholesale_only,
      colors: [...(colorsByP.get(p.id) ?? [])].sort(),
    };
  })
  // A shareable catalogue must never show a photo-less design (letter placeholder) — it looks unfinished
  // and drives customers away. Only list products that actually have a real image.
  .filter((c) => typeof c.image === "string" && c.image.startsWith("http"));
}

// ---------- customer directory (real customers table) ----------

export async function getCustomersDb(opts: { q?: string; type?: string }) {
  const sb = supabaseServer();
  let query = sb.from("customers").select("id,name,phone,type,gstin,city,credit_balance,created_at");
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.or(`name.ilike.%${s}%,phone.ilike.%${s}%,gstin.ilike.%${s}%`); }
  if (opts.type && opts.type !== "all") query = query.eq("type", opts.type);
  const { data } = await query.order("name");
  // Collapse anonymous walk-ins: they're bill placeholders, not real directory contacts.
  return ((data as any[]) ?? []).filter((c) => !isWalkInPlaceholder(c.name, c.phone));
}

/** Reuse the directory row for a real customer (phone last-10, then exact name). Never mint a
 *  second "Pooja Fashion" on a no-phone bill — that split this-month spend across two cards. */
export async function ensureDirectoryCustomer(
  sb: ReturnType<typeof supabaseServer>,
  input: { name?: string | null; phone?: string | null; gstin?: string | null; address?: string | null; type?: string | null },
): Promise<string | null> {
  const nm = (input.name ?? "").trim().replace(/\s+/g, " ");
  const ph = (input.phone ?? "").trim();
  if (isWalkInPlaceholder(nm, ph)) return null;
  const last10 = phoneLast10(ph);
  const nameKey = directoryNameKey(nm);
  let hit: any = null;
  if (last10) {
    const { data } = await sb.from("customers").select("id,name,phone,type").ilike("phone", `%${last10}%`).limit(20);
    hit = ((data as any[]) ?? []).find((c) => phoneLast10(c.phone) === last10) ?? null;
  }
  if (!hit && nameKey) {
    const fuzzy = nameKey.split(" ").filter(Boolean).join("%") || nameKey;
    const { data } = await sb.from("customers").select("id,name,phone,type").ilike("name", fuzzy).limit(40);
    const rows = ((data as any[]) ?? []).filter((c) => directoryNameKey(c.name) === nameKey);
    hit = rows.find((c) => c.type === "wholesale") ?? rows[0] ?? null;
  }
  if (hit?.id) {
    const patch: Record<string, string> = {};
    if (input.gstin?.trim()) patch.gstin = input.gstin.trim();
    if (input.address?.trim()) patch.address = input.address.trim();
    if (ph && !phoneLast10(hit.phone)) patch.phone = ph;
    if (input.type === "wholesale" && hit.type !== "wholesale") patch.type = "wholesale";
    if (Object.keys(patch).length) await sb.from("customers").update(patch).eq("id", hit.id);
    return hit.id as string;
  }
  const { data: created } = await sb.from("customers")
    .insert({ name: nm || last10 || ph, phone: ph || null, gstin: input.gstin?.trim() || null, address: input.address?.trim() || null, type: input.type === "wholesale" ? "wholesale" : "retail" })
    .select("id").maybeSingle();
  return ((created as any)?.id as string | undefined) ?? null;
}

// ---------- employees (salespeople) + sales attribution (0037) ----------
export type Employee = { id: string; name: string; phone: string | null; title: string | null; active: boolean };

/** Roster of employees. `activeOnly` for the POS salesperson picker. */
export async function getEmployees(opts: { activeOnly?: boolean } = {}): Promise<Employee[]> {
  const sb = supabaseServer();
  let q = sb.from("employees").select("id,name,phone,title,active").order("active", { ascending: false }).order("name");
  if (opts.activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (((data as any[]) ?? []) as Employee[]);
}

/** Per-employee sales performance over an optional date range (paise). Every employee is returned
 *  (even with 0 sales), highest sales first — the basis for performance-based rewards. */
export async function getEmployeePerformance(range?: { from?: string; to?: string }): Promise<{ id: string; name: string; active: boolean; orders: number; sales: number; collected: number }[]> {
  const sb = supabaseServer();
  const emps = await getEmployees({});
  // Exclude pending backorders (not sold yet — held like an estimate) and cancelled/refunded bills,
  // so a salesperson isn't credited for a sale that never actually happened.
  let q = sb.from("orders").select("sales_employee_id,total,amount_paid,created_at,status,is_backorder").not("sales_employee_id", "is", null).or("is_backorder.is.null,is_backorder.eq.false").eq("cod_hold", false);
  if (range?.from) q = q.gte("created_at", range.from);
  if (range?.to) q = q.lte("created_at", range.to);
  const { data } = await q;
  const agg = new Map<string, { orders: number; sales: number; collected: number }>();
  for (const o of ((data as any[]) ?? [])) {
    if (o.status === "cancelled" || o.status === "refunded") continue;
    const cur = agg.get(o.sales_employee_id) ?? { orders: 0, sales: 0, collected: 0 };
    cur.orders += 1; cur.sales += (o.total ?? 0); cur.collected += (o.amount_paid ?? 0);
    agg.set(o.sales_employee_id, cur);
  }
  return emps
    .map((e) => ({ id: e.id, name: e.name, active: e.active, ...(agg.get(e.id) ?? { orders: 0, sales: 0, collected: 0 }) }))
    .sort((a, b) => b.sales - a.sales);
}

/** Individual attributed sales (date + customer + amount) for the owner's employee ledger.
 *  Every bill tied to a salesperson in the period, newest first — so the owner can audit each sale. */
export async function getEmployeeSalesLedger(range?: { from?: string; to?: string }, limit = 300): Promise<{ id: string; invoice_no: string | null; employee: string; customer: string; total: number; amountPaid: number; billType: string; channel: string; created_at: string }[]> {
  const sb = supabaseServer();
  const emps = await getEmployees({});
  const nameById = new Map(emps.map((e) => [e.id, e.name]));
  let q = sb.from("orders")
    .select("id,invoice_no,sales_employee_id,customer_name,total,amount_paid,bill_type,channel,created_at,status")
    .not("sales_employee_id", "is", null)
    .or("is_backorder.is.null,is_backorder.eq.false").eq("cod_hold", false)
    .order("created_at", { ascending: false }).limit(limit);
  if (range?.from) q = q.gte("created_at", range.from);
  if (range?.to) q = q.lte("created_at", range.to);
  const { data } = await q;
  return ((data as any[]) ?? []).filter((o) => o.status !== "cancelled" && o.status !== "refunded").map((o) => ({
    id: o.id as string,
    invoice_no: (o.invoice_no ?? null) as string | null,
    employee: (nameById.get(o.sales_employee_id) ?? "—") as string,
    customer: (o.customer_name || "Walk-in") as string,
    total: (o.total ?? 0) as number,
    amountPaid: (o.amount_paid ?? 0) as number,
    billType: (o.bill_type ?? "") as string,
    channel: (o.channel ?? "") as string,
    created_at: o.created_at as string,
  }));
}

/** Per-customer spend + order count + last-order date over an optional date range (paise), keyed by
 *  customer_id. Powers promotional targeting on the Customers page (who hit / is near a target).
 *  Bills are attributed by customer_id, then last-10 phone, then firm name — so a ₹46,000
 *  "Pooja Fashion" bill counts on the directory row even if POS minted a duplicate or left customer_id null. */
export async function getCustomerSpend(range?: { from?: string; to?: string }): Promise<Map<string, { spend: number; orders: number; last: string | null }>> {
  const sb = supabaseServer();
  const dir = await fetchAll((f, t) => sb.from("customers").select("id,name,phone").range(f, t));
  const orders = await fetchAll((f, t) => {
    let q = sb.from("orders")
      .select("customer_id,customer_name,customer_phone,total,bill_type,gst_mode,created_at,status,is_backorder,cod_hold")
      .or("is_backorder.is.null,is_backorder.eq.false")
      .order("created_at", { ascending: true });
    if (range?.from) q = q.gte("created_at", range.from);
    if (range?.to) q = q.lte("created_at", range.to);
    return q.range(f, t);
  });

  const m = new Map<string, { spend: number; orders: number; last: string | null }>();
  const bump = (id: string, grand: number, at: string) => {
    const cur = m.get(id) ?? { spend: 0, orders: 0, last: null as string | null };
    cur.spend += grand; cur.orders += 1;
    if (!cur.last || at > cur.last) cur.last = at;
    m.set(id, cur);
  };
  for (const o of orders as any[]) {
    if (!isLiveSale(o)) continue;
    if (isWalkInPlaceholder(o.customer_name, o.customer_phone)) continue;
    const grand = billGrandPaise(o);
    const ids = directoryIdsForOrder(o, dir as any);
    // Same bill must not increment order-count twice when two directory copies share a name —
    // spend is copied to each row, order count once per row (the owner reads one card).
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      bump(id, grand, o.created_at);
    }
  }
  return m;
}


/** The rupee amount a customer actually OWES on one bill:
 *  grand total (bill total + GST charged ON TOP for exclusive GST bills, rounded to ₹1 exactly
 *  like the printed invoice) − amount paid − return credits (credit notes incl. their GST share).
 *  Fixes the client's two escalations: "GST chhod diya" (outstanding rose by the pre-tax total)
 *  and returns never reducing what the customer owes. */
export function orderReceivable(o: { total?: number | null; amount_paid?: number | null; bill_type?: string | null; gst_mode?: string | null }, returnCredit = 0): number {
  const total = o.total ?? 0;
  const grand = o.bill_type === "gst" && (o.gst_mode ?? "exclusive") !== "inclusive"
    ? Math.round((total + Math.round((total * 3) / 100)) / 100) * 100
    : total;
  return Math.max(0, grand - (o.amount_paid ?? 0) - returnCredit);
}

/** Σ return credit (returns.amount, incl. GST share) per order id, for a set of orders. */
export async function returnCreditsByOrder(orderIds: string[]): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!orderIds.length) return m;
  const sb = supabaseServer();
  const { data } = await sb.from("returns").select("ref_order_id,amount").eq("kind", "sales").in("ref_order_id", orderIds);
  for (const r of ((data as any[]) ?? [])) {
    if (!r.ref_order_id) continue;
    m.set(r.ref_order_id, (m.get(r.ref_order_id) ?? 0) + (r.amount ?? 0));
  }
  return m;
}
/** Creditors — customers who owe a balance, aggregated across all their bills (outstanding =
 *  Σ bill total − amount paid). Important for wholesale credit tracking. */
export async function getCreditors(): Promise<{ id: string | null; name: string; phone: string; outstanding: number; bills: number }[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("orders").select("id,customer_id,customer_name,customer_phone,total,amount_paid,bill_type,gst_mode,status");
  const rows0 = ((data as any[]) ?? []).filter((o) => o.status !== "cancelled");
  const credits = await returnCreditsByOrder(rows0.map((o) => o.id));
  const map = new Map<string, { id: string | null; name: string; phone: string; outstanding: number; bills: number }>();
  for (const o of rows0) {
    const due = orderReceivable(o, credits.get(o.id) ?? 0);
    if (due <= 0) continue;
    const key = o.customer_id ? `id:${o.customer_id}` : o.customer_phone ? `ph:${o.customer_phone}` : o.customer_name ? `nm:${o.customer_name}` : null;
    if (!key) continue;
    const cur = map.get(key) ?? { id: o.customer_id ?? null, name: o.customer_name || "Walk-in", phone: o.customer_phone || "", outstanding: 0, bills: 0 };
    cur.outstanding += due; cur.bills += 1;
    if (!cur.id && o.customer_id) cur.id = o.customer_id;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding);
}

/** Notify-Me — pending restock demand grouped by product (most-wanted first). */
export async function getNotifyRequests(): Promise<{ sku: string; name: string; qty: number; count: number; latest: string; people: { name: string; phone: string }[] }[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("notify_requests").select("sku,customer_name,customer_phone,created_at,product:products(name,qty)").order("created_at", { ascending: false }).limit(1000);
  const map = new Map<string, { sku: string; name: string; qty: number; count: number; latest: string; people: { name: string; phone: string }[] }>();
  for (const r of ((data as any[]) ?? [])) {
    const sku = r.sku || "—";
    const cur = map.get(sku) ?? { sku, name: r.product?.name ?? sku, qty: r.product?.qty ?? 0, count: 0, latest: r.created_at, people: [] as { name: string; phone: string }[] };
    cur.count++;
    if (cur.people.length < 12) cur.people.push({ name: r.customer_name || "—", phone: r.customer_phone || "" });
    map.set(sku, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Owner-managed bank / payment methods. Resilient: returns [] until migration 0025 runs. */
export type PaymentMethod = {
  id: string; name: string; kind: string; active: boolean; archived: boolean;
  is_default: boolean; sort: number;
  bank_name: string | null; account_name: string | null; account_number: string | null;
  upi_id: string | null; qr_code_url: string | null; branch: string | null;
  opening_balance: number; color: string | null; icon: string | null; notes: string | null;
  created_by: string | null; created_at: string | null;
};

const PM_COLS =
  "id,name,kind,active,archived,is_default,sort,bank_name,account_name,account_number,upi_id,qr_code_url,branch,opening_balance,color,icon,notes,created_by,created_at";

/** Master payment-method registry (single source of truth). Active, non-archived, default-first
 *  by default — that's exactly the list every billing screen should render. */
export async function getPaymentMethods(
  opts: { activeOnly?: boolean; includeArchived?: boolean } = {},
): Promise<PaymentMethod[]> {
  const sb = supabaseServer();
  // Resilient: if the v2 columns aren't deployed yet (migration 0027 not run), fall back to the
  // basic 0025 shape so billing never breaks.
  let q = sb.from("payment_methods").select(PM_COLS).order("is_default", { ascending: false }).order("sort").order("name");
  if (opts.activeOnly) q = q.eq("active", true);
  if (!opts.includeArchived) q = q.eq("archived", false);
  let { data, error } = await q;
  if (error) {
    const basic = await sb.from("payment_methods").select("id,name,kind,active").order("sort").order("name");
    return ((basic.data as any[]) ?? []).map((m) => ({
      ...m, archived: false, is_default: false, sort: 0, bank_name: null, account_name: null,
      account_number: null, upi_id: null, qr_code_url: null, branch: null, opening_balance: 0,
      color: null, icon: null, notes: null, created_by: null, created_at: null,
    }));
  }
  return (data as any[]) ?? [];
}

export type MethodBalance = PaymentMethod & {
  current_balance: number; total_in: number; total_out: number; today_in: number; today_out: number;
};

/** Every method enriched with its derived balance (from the payment_method_balances view) plus
 *  today's in/out totals. Used by the Bank & Payment Methods manager and the dashboard. */
export async function getPaymentMethodsWithBalances(
  opts: { includeArchived?: boolean } = {},
): Promise<MethodBalance[]> {
  const sb = supabaseServer();
  const methods = await getPaymentMethods({ includeArchived: opts.includeArchived });
  const [{ data: bals }, { data: today }] = await Promise.all([
    sb.from("payment_method_balances").select("method_id,current_balance,total_in,total_out"),
    sb.from("payment_method_transactions").select("method_id,direction,amount,occurred_at")
      .gte("occurred_at", new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);
  const balBy = new Map<string, any>();
  for (const b of ((bals as any[]) ?? [])) balBy.set(b.method_id, b);
  const todayBy = new Map<string, { in: number; out: number }>();
  for (const t of ((today as any[]) ?? [])) {
    const e = todayBy.get(t.method_id) ?? { in: 0, out: 0 };
    if (t.direction === "in") e.in += t.amount ?? 0; else e.out += t.amount ?? 0;
    todayBy.set(t.method_id, e);
  }
  return methods.map((m) => {
    const b = balBy.get(m.id) ?? {};
    const td = todayBy.get(m.id) ?? { in: 0, out: 0 };
    return {
      ...m,
      current_balance: Number(b.current_balance ?? m.opening_balance ?? 0),
      total_in: Number(b.total_in ?? 0), total_out: Number(b.total_out ?? 0),
      today_in: td.in, today_out: td.out,
    };
  });
}

/** Top-card aggregates for the Bank & Payment Methods dashboard. Balances come from the new
 *  per-method ledger; "today's payments" still reads the legacy supplier_payments so the figure
 *  is real until money-out flows are migrated to the ledger (Phase 2). */
export async function getPaymentDashboard() {
  const sb = supabaseServer();
  const methods = await getPaymentMethodsWithBalances();
  const byKind = (kinds: string[]) =>
    methods.filter((m) => kinds.includes((m.kind ?? "").toLowerCase())).reduce((s, m) => s + m.current_balance, 0);
  const cashBalance = byKind(["cash"]);
  const upiBalance = byKind(["upi", "wallet"]);
  const bankBalance = byKind(["bank", "card", "cheque", "razorpay", "other"]);
  const totalAcross = methods.reduce((s, m) => s + m.current_balance, 0);
  const todayCollections = methods.reduce((s, m) => s + m.today_in, 0);

  // Legacy money-out (supplier payments today) — keeps the card accurate pre-Phase-2.
  const startOfDay = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const { data: pays } = await sb.from("supplier_payments").select("amount,created_at").gte("created_at", startOfDay);
  const ledgerOutToday = methods.reduce((s, m) => s + m.today_out, 0);
  const supplierOutToday = ((pays as any[]) ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);
  const todayPayments = ledgerOutToday + supplierOutToday;

  return {
    cashBalance, bankBalance, upiBalance, totalAcross, todayCollections, todayPayments,
    netPosition: todayCollections - todayPayments, methodCount: methods.length,
  };
}

/** Bank/UPI collected, grouped by the payment method that received it (Bank & Cash breakdown). */
export async function getBankMethodTotals(): Promise<{ method: string; total: number }[]> {
  const sb = supabaseServer();
  const { data, error } = await sb.from("orders").select("payment_method,pay_bank");
  if (error) return [];
  const map = new Map<string, number>();
  for (const o of ((data as any[]) ?? [])) {
    const amt = o.pay_bank ?? 0;
    if (amt <= 0) continue;
    const m = (o.payment_method && String(o.payment_method).trim()) || "Unassigned";
    map.set(m, (map.get(m) ?? 0) + amt);
  }
  return [...map.entries()].map(([method, total]) => ({ method, total })).sort((a, b) => b.total - a.total);
}

/** Storefront account: a signed-in shopper's own orders (matched by their mobile), newest first. */
export async function getCustomerOrders(phone10: string): Promise<{ id: string; invoice_no: string | null; total: number; amount_paid: number; status: string | null; bill_type: string | null; channel: string | null; created_at: string }[]> {
  const p = (phone10 ?? "").replace(/\D/g, "").slice(-10);
  if (p.length !== 10) return [];
  const sb = supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,invoice_no,total,amount_paid,status,bill_type,channel,created_at,customer_phone")
    .ilike("customer_phone", `%${p}`)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data as any[]) ?? []).map((o) => ({
    id: o.id, invoice_no: o.invoice_no ?? null, total: o.total ?? 0, amount_paid: o.amount_paid ?? 0,
    status: o.status ?? null, bill_type: o.bill_type ?? null, channel: o.channel ?? null, created_at: o.created_at,
  }));
}

/** Storefront account: the customer's saved profile (name/phone), or null. */
export async function getCustomerProfile(phone10: string): Promise<{ name: string | null; phone: string | null } | null> {
  const p = (phone10 ?? "").replace(/\D/g, "").slice(-10);
  if (p.length !== 10) return null;
  const sb = supabaseServer();
  const { data } = await sb.from("customers").select("name,phone").ilike("phone", `%${p}`).limit(1);
  const c = (data as any[])?.[0];
  return c ? { name: c.name ?? null, phone: c.phone ?? null } : { name: null, phone: p };
}

export async function getCustomerById(id: string) {
  const sb = supabaseServer();
  const { data: c } = await sb.from("customers").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  // Order history: linked customer_id plus any POS sales saved with the same phone.
  // (Two separate queries merged — avoids putting a raw phone into an or() filter.)
  const phone = (c as any).phone;
  const sel = "id,total,amount_paid,invoice_no,channel,bill_type,gst_mode,payment_mode,status,created_at,customer_id,customer_phone";
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
  const custCredits = await returnCreditsByOrder(list.map((o: any) => o.id));
  const outstandingFromOrders = list
    .filter((o: any) => o.status !== "cancelled" && o.status !== "void")
    .reduce((s: number, o: any) => s + orderReceivable(o, custCredits.get(o.id) ?? 0), 0);
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
export async function getOrdersPage(opts: { page?: number; pageSize?: number; q?: string; channel?: string; from?: string; to?: string; sort?: string; billType?: string }) {
  const sb = supabaseServer();
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  let query = sb.from("orders").select("id,total,amount_paid,invoice_no,channel,status,payment_mode,bill_type,gst_mode,customer_name,customer_phone,source_tag,created_at", { count: "exact" });
  // Open backorders are NOT sales yet — they hold no stock and post no revenue until the owner
  // fulfils them on /admin/backorders. Keep them out of the sales record. (is_backorder may not
  // exist pre-migration-0020; PostgREST treats .not on a missing column as an error, so this is
  // written as .or to stay resilient.)
  query = query.or("is_backorder.is.null,is_backorder.eq.false");
  // Held COD orders aren't sales yet either — they live on /admin/cod until dispatch is confirmed.
  query = query.eq("cod_hold", false);
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.or(`customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%`); }
  if (opts.channel && opts.channel !== "all") query = query.eq("channel", opts.channel);
  if (opts.billType) query = query.eq("bill_type", opts.billType);
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
  const rows = (data as any[]) ?? [];
  // Attach returned-piece counts so the sales list shows "↩ N returned" on affected bills —
  // the chain-of-events note the client asked for (avoids double returns / miscommunication).
  if (rows.length) {
    const { data: rets } = await sb.from("returns").select("ref_order_id,qty").eq("kind", "sales").in("ref_order_id", rows.map((r) => r.id));
    const by = new Map<string, number>();
    for (const r of ((rets as any[]) ?? [])) if (r.ref_order_id) by.set(r.ref_order_id, (by.get(r.ref_order_id) ?? 0) + (r.qty ?? 0));
    for (const r of rows) r.returned_qty = by.get(r.id) ?? 0;
  }
  return { rows, total: count ?? 0, page, pageSize };
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
    .select("id,total,amount_paid,status,payment_ref,created_at,invoice_no, order_items(qty, product:products(sku,name))")
    .eq("customer_id", customerId).eq("channel", "wholesale")
    .order("created_at", { ascending: false }).limit(20);
  return ((orders as any[]) ?? []).map((o) => ({
    id: o.id as string, total: (o.total ?? 0) as number, amountPaid: (o.amount_paid ?? 0) as number,
    status: (o.status ?? "placed") as string, paymentRef: (o.payment_ref ?? null) as string | null,
    created_at: o.created_at as string, invoice_no: (o.invoice_no ?? null) as string | null,
    items: ((o.order_items as any[]) ?? []).map((it) => ({ sku: it.product?.sku as string, name: it.product?.name as string, qty: it.qty as number })).filter((x) => x.sku),
  }));
}

/** Wholesale RFQs — dealer quote requests for the owner to price (newest first). */
export async function getWholesaleQuoteRequests() {
  const sb = supabaseServer();
  const { data } = await sb.from("wholesale_quote_requests")
    .select("id,dealer_name,dealer_phone,details,status,created_at")
    .order("created_at", { ascending: false }).limit(200);
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id as string, dealerName: (r.dealer_name ?? "Dealer") as string, dealerPhone: (r.dealer_phone ?? null) as string | null,
    details: (r.details ?? "") as string, status: (r.status ?? "open") as string, created_at: r.created_at as string,
  }));
}

/** Supplier ledger (#36): a vendor's purchase history with running totals. */
export async function getSupplierLedger(id: string) {
  const sb = supabaseServer();
  const { data: supplier } = await sb.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (!supplier) return null;
  const [{ data: purchases }, { data: pays }] = await Promise.all([
    sb.from("purchases").select("id,bill_no,total,created_at, items:purchase_items(qty)").eq("supplier_id", id).order("created_at", { ascending: false }),
    sb.from("supplier_payments").select("id,amount,mode,ref,note,created_at,method_id").eq("supplier_id", id).order("created_at", { ascending: false }),
  ]);
  const list = ((purchases as any[]) ?? []).map((p) => ({
    id: p.id, bill_no: p.bill_no, total: p.total ?? 0, created_at: p.created_at,
    qty: ((p.items as any[]) ?? []).reduce((s, x) => s + (x.qty ?? 0), 0),
    lines: ((p.items as any[]) ?? []).length,
  }));
  // Resolve each payment's SPECIFIC account name (Kotak / SBI / HDFC / UPI / Cash) so the ledger shows
  // where the money went out from, not just a coarse "bank".
  const pmIds = [...new Set(((pays as any[]) ?? []).map((p) => p.method_id).filter(Boolean))] as string[];
  const pmName = new Map<string, string>();
  if (pmIds.length) {
    const { data: pms } = await sb.from("payment_methods").select("id,name").in("id", pmIds);
    for (const m of ((pms as any[]) ?? [])) pmName.set(m.id, m.name);
  }
  const payments = ((pays as any[]) ?? []).map((p) => ({ id: p.id, amount: p.amount ?? 0, mode: (p.method_id && pmName.get(p.method_id)) ? pmName.get(p.method_id)! : (p.mode as string), ref: p.ref as string | null, note: p.note as string | null, created_at: p.created_at }));
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

/** Date-filterable cash & bank ledger for the cashbook page. Returns each money movement
 *  (collections from orders, payments to suppliers) tagged with cash/bank amounts and which
 *  bank/method, so the page can: filter to cash-only or bank-only, group day-wise, and break the
 *  bank total down by account. payment_method may not exist in every DB → falls back gracefully. */
export async function getCashBankLedger(opts: { from?: string; to?: string } = {}): Promise<{
  moves: { date: string; label: string; link: string | null; cash: number; bank: number; method: string | null }[];
}> {
  const sb = supabaseServer();
  const applyRange = (q: any) => {
    let x = q;
    if (opts.from) x = x.gte("created_at", opts.from);
    if (opts.to) x = x.lte("created_at", opts.to);
    return x;
  };

  const RICH = "id,invoice_no,customer_name,pay_cash,pay_bank,payment_method,created_at";
  const BASIC = "id,invoice_no,customer_name,pay_cash,pay_bank,created_at";
  let ores = await applyRange(sb.from("orders").select(RICH).or("pay_cash.gt.0,pay_bank.gt.0").order("created_at", { ascending: false }).limit(3000));
  if (ores.error) ores = await applyRange(sb.from("orders").select(BASIC).or("pay_cash.gt.0,pay_bank.gt.0").order("created_at", { ascending: false }).limit(3000));
  const orders = (ores.data as any[]) ?? [];

  const pres = await applyRange(sb.from("supplier_payments").select("id,supplier_id,amount,mode,note,created_at, supplier:suppliers(name)").order("created_at", { ascending: false }).limit(3000));
  const pays = (pres.data as any[]) ?? [];

  const moves: { date: string; label: string; link: string | null; cash: number; bank: number; method: string | null }[] = [];
  for (const o of orders) {
    const bank = o.pay_bank ?? 0;
    moves.push({
      date: o.created_at,
      label: `Collection · ${o.invoice_no || String(o.id).slice(0, 6).toUpperCase()}${o.customer_name ? ` · ${o.customer_name}` : ""}`,
      link: `/admin/invoice/${o.id}`,
      cash: o.pay_cash ?? 0,
      bank,
      method: bank > 0 ? (o.payment_method || "Bank / UPI") : null,
    });
  }
  for (const p of pays) {
    const isCash = p.mode === "cash";
    moves.push({
      date: p.created_at,
      label: `Paid supplier · ${p.supplier?.name ?? ""}${p.note ? ` — ${p.note}` : ""}`,
      link: `/admin/supplier/${p.supplier_id}`,
      cash: isCash ? -(p.amount ?? 0) : 0,
      bank: isCash ? 0 : -(p.amount ?? 0),
      method: isCash ? null : (p.mode || "Bank / UPI"),
    });
  }
  moves.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return { moves };
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
export type LabelItem = {
  sku: string; name: string;
  price: number;         // retail (paise)
  wholesale: number;     // wholesale rate (paise)
  mrp: number;           // printed MRP (paise)
  kind: "product" | "variant";
  option?: string;       // e.g. "Red / M" — set on variant rows
  parentSku?: string;    // the product SKU a variant belongs to
  variantCount?: number; // on product rows — how many printable variants it has
};
export async function getLabelItems(): Promise<LabelItem[]> {
  const sb = supabaseServer();
  const formula = await getPricingFormula();
  // PAGE through ALL products+variants — 4000+ products blow past PostgREST's 1000-row cap, so without
  // paging products (and any newly-added colour variants) past the first ~1000 never showed on the
  // barcode screen ("variant SKU not showing in barcodes").
  const data = await fetchAll((f, t) => sb
    .from("products")
    .select("sku,name,base_wholesale,wholesale_override,retail_override,mrp_override, variants(sku,color,size,polish,wholesale_override,retail_override,mrp_override)")
    .order("sku").range(f, t));
  const out: LabelItem[] = [];
  for (const p of (data as any[]) ?? []) {
    const vs = ((p.variants as any[]) ?? []).filter((v) => v.sku);
    const pp = _resolvePrices(p.base_wholesale, formula, overridesOf(null), overridesOf(p));
    out.push({
      sku: p.sku, name: p.name,
      price: pp.retailPrice, wholesale: pp.wholesaleRate, mrp: pp.mrp,
      kind: "product", variantCount: vs.length,
    });
    for (const v of vs) {
      // Barcode labels carry the COLOUR only (owner: never the polish, e.g. not "Gold / Gold").
      // Size is the fallback for size-only variants (bangles) so their tag isn't blank.
      const opt = (v.color || v.size || "").trim() || null;
      const vp = _resolvePrices(p.base_wholesale, formula, overridesOf(v), overridesOf(p));
      out.push({
        sku: v.sku, name: `${p.name}${opt ? ` — ${opt}` : ""}`,
        price: vp.retailPrice, wholesale: vp.wholesaleRate, mrp: vp.mrp,
        kind: "variant", option: opt || undefined, parentSku: p.sku,
      });
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
  const data = await fetchAll((f, t) => sb.from("products").select("sku, category:categories(slug)").eq("status", "published").range(f, t));
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
  const rows = (data as any[]) ?? [];
  // The old-system import logged a one-time "Stock reconciliation" entry (a ±1–2 physical-count tweak)
  // separately from the opening balance. It's not a day-to-day adjustment, and shown as its own line it
  // looks like a phantom "Adjustment" that confuses the owner. Fold it INTO the Opening line so the
  // history reads cleanly (Opening N → then real sales/returns). The running balance is unchanged
  // because the reconciliation's units are simply added to the opening's units.
  const isRecon = (r: any) => (r.source ?? "").toLowerCase().includes("reconcil");
  const reconDelta = rows.filter(isRecon).reduce((s, r) => s + (Number(r.delta) || 0), 0);
  const opening = rows.find((r) => (r.kind ?? "") === "opening");
  if (reconDelta && opening) {
    opening.delta = (Number(opening.delta) || 0) + reconDelta;
    return rows.filter((r) => !isRecon(r));
  }
  // No opening line in this window → present the reconciliation as part of the opening import, not a
  // stray adjustment, so it never reads as a mysterious stock change.
  return rows.map((r) => (isRecon(r) ? { ...r, kind: "opening", source: "Opening stock (import)" } : r));
}

/** Open estimates that reserve this product (soft holds — not yet billed, so not in the
 *  stock ledger). Shown alongside the product's stock movements (Meeting 2 §2). */
export async function getProductEstimateReservations(productId: string): Promise<{ id: string; customer: string | null; qty: number; created_at: string }[]> {
  if (!productId) return [];
  const sb = supabaseServer();
  const { data } = await sb
    .from("estimate_items")
    .select("qty, estimate:estimates(id,customer_name,status,created_at)")
    .eq("product_id", productId);
  return ((data as any[]) ?? [])
    .filter((r) => r.estimate && r.estimate.status === "open")
    .map((r) => ({ id: r.estimate.id as string, customer: r.estimate.customer_name as string | null, qty: r.qty as number, created_at: r.estimate.created_at as string }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/**
 * EVERY estimate that includes this product — ANY status (open / converted / cash_billed) — for the
 * movement history so quotes are tracked with date, party, variant, qty and price, and are clickable
 * through to the estimate. (getProductEstimateReservations only returns the OPEN soft-holds.)
 */
export async function getProductEstimates(productId: string): Promise<{ id: string; customer: string | null; status: string; qty: number; unitPrice: number; lineTotal: number; variant: string | null; created_at: string }[]> {
  if (!productId) return [];
  const sb = supabaseServer();
  const { data } = await sb
    .from("estimate_items")
    .select("qty,unit_price,line_total, variant:variants(color), estimate:estimates(id,customer_name,status,created_at)")
    .eq("product_id", productId);
  return ((data as any[]) ?? [])
    .filter((r) => r.estimate)
    .map((r) => ({
      id: r.estimate.id as string,
      customer: (r.estimate.customer_name as string | null) ?? null,
      status: (r.estimate.status as string) ?? "open",
      qty: (r.qty as number) ?? 0,
      unitPrice: (r.unit_price as number) ?? 0,
      lineTotal: (r.line_total as number) ?? (((r.unit_price as number) ?? 0) * ((r.qty as number) ?? 0)),
      variant: (r.variant?.color as string | null) ?? null,
      created_at: r.estimate.created_at as string,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// Pillar 5 — the single Stock Movement History register: every in/out across all products,
// each row carrying ref_id so its purchase/sale bill opens straight from here.
export async function getStockMovements(opts: { page?: number; pageSize?: number; kind?: string; q?: string; from?: string; to?: string }) {
  const sb = supabaseServer();
  const pageSize = opts.pageSize ?? 30;
  const page = Math.max(1, opts.page ?? 1);
  let query = sb.from("stock_adjustments")
    .select("id,product_id,variant_id,delta,kind,source,reason,ref_id,sku,created_at, product:products(sku,name), variant:variants(color,qty)", { count: "exact" });
  if (opts.kind && opts.kind !== "all") query = query.eq("kind", opts.kind);
  if (opts.q?.trim()) { const s = escLike(opts.q); if (s) query = query.ilike("sku", `%${s}%`); }
  if (opts.from) query = query.gte("created_at", opts.from);
  if (opts.to) query = query.lte("created_at", opts.to);
  const fromIdx = (page - 1) * pageSize;
  const { data, count } = await query.order("created_at", { ascending: false }).range(fromIdx, fromIdx + pageSize - 1);
  const rows = (data as any[]) ?? [];
  // Attach the bill/invoice number to each sale row (ref_id → orders.invoice_no). ref_id is a
  // generic reference (orders/purchases/estimates), not a PostgREST FK, so we look it up in one
  // extra query and map it back rather than embedding.
  // Customer returns reference the ORDER; purchase returns reference the PURCHASE — both need
  // their party and rate resolved just like plain sales/purchases (the owner traces returns too).
  const saleRefs = [...new Set(rows.filter((r) => (r.kind === "sale" || r.kind === "return") && r.ref_id).map((r) => r.ref_id))];
  const purchaseRefs = [...new Set(rows.filter((r) => (r.kind === "purchase" || r.kind === "purchase_return") && r.ref_id).map((r) => r.ref_id))];
  // Estimate-kind (soft hold) AND reserve-kind (held estimate hard-hold) both link to an estimate, so
  // resolve the customer for both — a "reserved" movement must show WHO it's held for, not a blank party.
  const estimateRefs = [...new Set(rows.filter((r) => (r.kind === "estimate" || r.kind === "reserve") && r.ref_id).map((r) => r.ref_id))];
  // party = the person/firm involved (customer on a sale/estimate/return, supplier on a purchase).
  const partyBy = new Map<string, string>();
  if (saleRefs.length) {
    const { data: ords } = await sb.from("orders").select("id,invoice_no,customer_name").in("id", saleRefs as string[]);
    const byId = new Map(((ords as any[]) ?? []).map((o) => [o.id, o]));
    for (const r of rows) if ((r.kind === "sale" || r.kind === "return") && r.ref_id) { const o = byId.get(r.ref_id); r.invoice_no = o?.invoice_no ?? null; if (o?.customer_name) partyBy.set(r.ref_id, o.customer_name); }
  }
  if (purchaseRefs.length) {
    const { data: purs } = await sb.from("purchases").select("id, supplier:suppliers(name)").in("id", purchaseRefs as string[]);
    for (const p of ((purs as any[]) ?? [])) if (p.supplier?.name) partyBy.set(p.id, p.supplier.name);
  }
  if (estimateRefs.length) {
    const { data: ests } = await sb.from("estimates").select("id,customer_name").in("id", estimateRefs as string[]);
    for (const e of ((ests as any[]) ?? [])) if (e.customer_name) partyBy.set(e.id, e.customer_name);
  }
  for (const r of rows) r.party = r.ref_id ? (partyBy.get(r.ref_id) ?? null) : null;

  // PRICE per movement — the owner checks "what did I sell/buy this at last time" from this very
  // register. Batch-resolved: sale rows → order_items.unit_price, purchase rows →
  // purchase_items.unit_cost, estimate rows → estimate_items.unit_price. Variant-exact when the
  // movement carries a variant; falls back to the product-level line.
  const priceKey = (ref: string, prod: string, vid: string | null) => `${ref}|${prod}|${vid ?? ""}`;
  const priceBy = new Map<string, number>();
  if (saleRefs.length) {
    const { data: ois } = await sb.from("order_items").select("order_id,product_id,variant_id,unit_price").in("order_id", saleRefs as string[]);
    for (const oi of ((ois as any[]) ?? [])) {
      priceBy.set(priceKey(oi.order_id, oi.product_id, oi.variant_id ?? null), oi.unit_price ?? 0);
      if (!priceBy.has(priceKey(oi.order_id, oi.product_id, null))) priceBy.set(priceKey(oi.order_id, oi.product_id, null), oi.unit_price ?? 0);
    }
  }
  if (purchaseRefs.length) {
    const { data: pis } = await sb.from("purchase_items").select("purchase_id,mapped_product_id,unit_cost").in("purchase_id", purchaseRefs as string[]);
    for (const pi of ((pis as any[]) ?? [])) if (pi.mapped_product_id) priceBy.set(priceKey(pi.purchase_id, pi.mapped_product_id, null), pi.unit_cost ?? 0);
  }
  if (estimateRefs.length) {
    const { data: eis } = await sb.from("estimate_items").select("estimate_id,product_id,variant_id,unit_price").in("estimate_id", estimateRefs as string[]);
    for (const ei of ((eis as any[]) ?? [])) {
      priceBy.set(priceKey(ei.estimate_id, ei.product_id, ei.variant_id ?? null), ei.unit_price ?? 0);
      if (!priceBy.has(priceKey(ei.estimate_id, ei.product_id, null))) priceBy.set(priceKey(ei.estimate_id, ei.product_id, null), ei.unit_price ?? 0);
    }
  }
  for (const r of rows) {
    r.price = r.ref_id && r.product_id
      ? (priceBy.get(priceKey(r.ref_id, r.product_id, r.variant_id ?? null)) ?? priceBy.get(priceKey(r.ref_id, r.product_id, null)) ?? null)
      : null;
  }
  return { rows, total: count ?? 0, page, pageSize };
}

// Pillar 6 — open estimates "reserve" stock softly (not yet billed). Surface them, highlighted,
// at the top of the Stock Movement register so the owner sees what's spoken-for by live quotes.
export async function getOpenEstimateReservations(limit = 50) {
  const sb = supabaseServer();
  const { data } = await sb
    .from("estimates")
    .select("id, customer_name, created_at, estimate_items(qty, unit_price, variant:variants(color), product:products(sku,name))")
    // OPEN estimates only: these are quotes that haven't reserved stock (informational soft-hold). A HELD
    // estimate hard-reserves its pieces via real 'reserve' stock movements, so it's already reflected in
    // live stock and the ledger — including it here too would double-count it.
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? []).map((e) => ({
    id: e.id as string,
    customer_name: e.customer_name as string | null,
    created_at: e.created_at as string,
    lines: ((e.estimate_items as any[]) ?? []).map((li) => ({
      qty: li.qty as number, sku: li.product?.sku as string | undefined, name: li.product?.name as string | undefined,
      color: (li.variant?.color as string | null) ?? null, unitPrice: (li.unit_price as number | null) ?? null,
    })),
    qty: ((e.estimate_items as any[]) ?? []).reduce((s, li) => s + (li.qty ?? 0), 0),
  })).filter((e) => e.lines.length > 0);
}

/**
 * PENDING HELD ORDERS — backorders and COD-hold orders are committed to a customer but their stock has
 * NOT been deducted yet (it only moves when the owner fulfils/dispatches). So they never appear as a
 * stock_adjustments row, which confused the owner ("backorder is not visible in stock movement"). This
 * surfaces them as pending stock-OUT holds on the Stock Movement page, exactly like open-estimate
 * reservations — so every future outflow is visible in one place.
 */
export async function getPendingHeldOrders(limit = 60) {
  const sb = supabaseServer();
  const { data } = await sb
    .from("orders")
    .select("id, invoice_no, customer_name, channel, is_backorder, cod_hold, payment_mode, created_at, order_items(qty, unit_price, variant:variants(color), product:products(sku,name))")
    // This page is for BACKORDERS and true COD holds only. Prepaid orders are now also held until accepted,
    // but they live in the storefront "pack & ship" box (accepted there) — don't repeat them on the COD page.
    .or("is_backorder.eq.true,and(cod_hold.eq.true,payment_mode.eq.cod)")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data as any[]) ?? []).map((o) => ({
    id: o.id as string,
    invoice_no: (o.invoice_no as string | null) ?? null,
    customer_name: o.customer_name as string | null,
    channel: (o.channel as string | null) ?? null,
    // A row can only be one hold type; backorder takes precedence if somehow both are set.
    kind: (o.is_backorder ? "backorder" : "cod") as "backorder" | "cod",
    created_at: o.created_at as string,
    lines: ((o.order_items as any[]) ?? []).map((li) => ({
      qty: li.qty as number, sku: li.product?.sku as string | undefined, name: li.product?.name as string | undefined,
      color: (li.variant?.color as string | null) ?? null, unitPrice: (li.unit_price as number | null) ?? null,
    })),
    qty: ((o.order_items as any[]) ?? []).reduce((s, li) => s + (li.qty ?? 0), 0),
  })).filter((o) => o.lines.length > 0);
}

// ---------- Product Stock Ledger (SAP/Zoho-style per-SKU inventory history) ----------
// DERIVED from the existing stock_adjustments rows (no duplicate inventory table). Computes a
// running balance, pulls open-estimate reservations, resolves related documents, and rolls up
// analytics — for the drawer opened by clicking any Stock Movement row.
export type LedgerMovement = {
  id: string; kind: string; delta: number; runningBalance: number | null;
  source: string | null; reason: string | null; created_by: string | null;
  ref_id: string | null; created_at: string; invoice_no?: string | null;
  /** Customer name (sales/estimates) or supplier name (purchases) for this movement. */
  party?: string | null;
  /** True for estimate/reservation holds — soft commitments that do NOT change the stock balance. */
  hold?: boolean;
  variant?: { color: string | null; sku: string | null } | null;
  /** Unit price of this movement (paise): sale/estimate = billed rate, purchase = unit cost. */
  price?: number | null;
  /** Running balance of THIS movement's variant (colour) — anchored to the variant's own stock. */
  variantBalance?: number | null;
  doc: { href: string; label: string } | null;
};

export async function getProductLedger(productId: string, opts: { offset?: number; limit?: number } = {}) {
  if (!productId) return null;
  const sb = supabaseServer();
  const limit = opts.limit ?? 50;
  const offset = Math.max(0, opts.offset ?? 0);

  // --- product header ---
  const { data: p } = await sb.from("products")
    .select("id,sku,name,qty,reorder_level,last_movement_at, category:categories(name), images:product_images(path,sort)")
    .eq("id", productId).maybeSingle();
  if (!p) return null;
  const prod = p as any;
  const image = ((prod.images ?? []).filter((i: any) => typeof i.path === "string" && i.path.startsWith("http"))
    .sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.path) ?? null;

  // --- ALL movements (ascending) to compute the running balance. Resilient to a deployed DB
  //     that hasn't added ref_id / created_by yet (falls back to the always-present columns). ---
  let allRows: any[] = [];
  const rich = await sb.from("stock_adjustments")
    .select("id,delta,kind,source,reason,ref_id,created_by,created_at,variant_id")
    .eq("product_id", productId).order("created_at", { ascending: true }).order("id", { ascending: true });
  if (rich.error) {
    const basic = await sb.from("stock_adjustments")
      .select("id,delta,kind,source,reason,created_at,variant_id")
      .eq("product_id", productId).order("created_at", { ascending: true });
    allRows = (basic.data as any[]) ?? [];
  } else allRows = (rich.data as any[]) ?? [];

  // --- variants of this product: attach colour to each movement + build a per-colour breakdown so
  //     the owner can see the stock movement of every variant, not just the product total. ---
  const { data: varRows } = await sb.from("variants").select("id,sku,color,qty").eq("product_id", productId);
  const variantById = new Map<string, { id: string; sku: string; color: string | null; qty: number }>();
  for (const v of ((varRows as any[]) ?? [])) variantById.set(v.id, { id: v.id, sku: v.sku, color: v.color ?? null, qty: v.qty ?? 0 });
  const vAgg = new Map<string, { purchased: number; sold: number; returned: number; net: number }>();
  for (const r of allRows) {
    if (!r.variant_id) continue;
    const a2 = vAgg.get(r.variant_id) ?? { purchased: 0, sold: 0, returned: 0, net: 0 };
    const d = r.delta ?? 0;
    if (r.kind === "purchase") a2.purchased += Math.max(0, d);
    if (r.kind === "sale") a2.sold += Math.abs(Math.min(0, d));
    // Returns are part of every colour's story: customer returns come back IN (+), supplier
    // returns go OUT (−) — the client's "variant ledger" must show them, not just the totals.
    if (r.kind === "return" || r.kind === "purchase_return") a2.returned += Math.abs(d);
    a2.net += d;
    vAgg.set(r.variant_id, a2);
  }
  const variants = [...variantById.values()]
    .map((v) => ({ ...v, purchased: vAgg.get(v.id)?.purchased ?? 0, sold: vAgg.get(v.id)?.sold ?? 0, returned: vAgg.get(v.id)?.returned ?? 0, net: vAgg.get(v.id)?.net ?? 0 }))
    .sort((a, b) => (a.color ?? "").localeCompare(b.color ?? ""));

  // Running balance is ANCHORED to the actual on-hand stock (products.qty — the source of truth that
  // POS sales and purchase bills update atomically). We set the NEWEST movement's closing balance to
  // the current stock, then walk backwards subtracting each delta. This guarantees (a) the top of the
  // ledger always equals the real stock the owner sees, and (b) every row chains exactly
  // (row.balance − row.delta = the row below it). The old "sum forward from 0" drifted whenever an
  // opening count or a PIM stock edit changed qty without leaving a matching ledger row.
  const deltaSum = allRows.reduce((s, r) => s + (r.delta ?? 0), 0);
  // For a product WITH colours, the real on-hand stock is the sum of its colours — that is what the
  // Variants tab and the catalogue show the owner. Anchoring to the separate product-level qty column
  // made the History header disagree with the Variants tab (10 vs 9) and fabricated a phantom
  // "Adjustment −1" baseline row to explain a gap that did not exist. One number, one source.
  const variantStock = variants.reduce((s, v) => s + (Number((v as any).qty) || 0), 0);
  const currentStock = variants.length > 0 ? variantStock : (prod.qty ?? deltaSum);
  let running = currentStock;
  for (let i = allRows.length - 1; i >= 0; i--) {
    allRows[i].runningBalance = running;
    running -= allRows[i].delta ?? 0;
  }
  // PER-COLOUR running balance (client: "a Pink +10 must show Pink's 10, not the product's 30"):
  // each variant's chain is anchored to ITS OWN current stock and walked backwards through only
  // its movements. Shown in the drawer whenever a colour filter is active.
  {
    const vRun = new Map<string, number>();
    for (const [vid, v] of variantById) vRun.set(vid, v.qty ?? 0);
    for (let i = allRows.length - 1; i >= 0; i--) {
      const vid = allRows[i].variant_id;
      if (!vid || !vRun.has(vid)) { allRows[i].variantBalance = null; continue; }
      const bal = vRun.get(vid)!;
      allRows[i].variantBalance = bal;
      vRun.set(vid, bal - (allRows[i].delta ?? 0));
    }
  }

  // --- related documents (batch lookups) ---
  const saleRefs = [...new Set(allRows.filter((r) => (r.kind === "sale" || r.kind === "return") && r.ref_id).map((r) => r.ref_id))];
  const purchaseRefs = [...new Set(allRows.filter((r) => (r.kind === "purchase" || r.kind === "purchase_return") && r.ref_id).map((r) => r.ref_id))];
  const estimateRefs = [...new Set(allRows.filter((r) => r.kind === "estimate" && r.ref_id).map((r) => r.ref_id))];
  // A "reserve" movement is a HELD estimate physically setting a piece aside for a customer. Its ref_id
  // is that estimate — resolve it so the row shows WHO it's held for + a link, instead of a bare "−1".
  const reserveRefs = [...new Set(allRows.filter((r) => r.kind === "reserve" && r.ref_id).map((r) => r.ref_id))];
  const invoiceBy = new Map<string, string>();
  const billBy = new Map<string, string>();
  // Party = who the movement was with — the customer on a sale/estimate, the supplier on a purchase.
  // Surfaced on every timeline row so the owner can trace "sold 2 to Riya" without opening the bill.
  const partyBy = new Map<string, string>();
  if (saleRefs.length) { const { data } = await sb.from("orders").select("id,invoice_no,customer_name").in("id", saleRefs as string[]); for (const o of (data as any[]) ?? []) { invoiceBy.set(o.id, o.invoice_no); if (o.customer_name) partyBy.set(o.id, o.customer_name); } }
  if (purchaseRefs.length) { const { data } = await sb.from("purchases").select("id,bill_no, supplier:suppliers(name)").in("id", purchaseRefs as string[]); for (const o of (data as any[]) ?? []) { billBy.set(o.id, o.bill_no); if (o.supplier?.name) partyBy.set(o.id, o.supplier.name); } }
  const estPartyRefs = [...new Set([...estimateRefs, ...reserveRefs])];
  if (estPartyRefs.length) { const { data } = await sb.from("estimates").select("id,customer_name").in("id", estPartyRefs as string[]); for (const o of (data as any[]) ?? []) { if (o.customer_name) partyBy.set(o.id, o.customer_name); } }

  const docFor = (r: any): { href: string; label: string } | null => {
    if (!r.ref_id) return null;
    if (r.kind === "sale") return { href: `/admin/invoice/${r.ref_id}`, label: "Open invoice →" };
    if (r.kind === "purchase") return { href: `/admin/purchase/${r.ref_id}`, label: "Open purchase →" };
    if (r.kind === "estimate") return { href: `/admin/estimate/${r.ref_id}`, label: "Open estimate →" };
    if (r.kind === "reserve") return { href: `/admin/estimate/${r.ref_id}`, label: "Open held estimate →" };
    if (r.kind === "return" || r.kind === "purchase_return") return { href: `/admin/returns`, label: "Open return →" };
    return null;
  };

  // --- estimates for this product (ANY status, with variant + price) — every quote is tracked in the
  //     ledger and the timeline; only OPEN estimates soft-hold stock. ---
  const { data: resv } = await sb.from("estimate_items")
    .select("qty,unit_price,line_total, variant:variants(color), estimate:estimates(id,customer_name,status,created_at)")
    .eq("product_id", productId);
  const resvRows = ((resv as any[]) ?? []).filter((r) => r.estimate);
  const reservations = resvRows
    .map((r) => ({
      id: r.estimate.id as string,
      customer: (r.estimate.customer_name as string) ?? "Walk-in",
      qty: (r.qty as number) ?? 0,
      unitPrice: (r.unit_price as number) ?? 0,
      lineTotal: (r.line_total as number) ?? (((r.unit_price as number) ?? 0) * ((r.qty as number) ?? 0)),
      variant: (r.variant?.color as string | null) ?? null,
      status: r.estimate.status as string,
      created_at: r.estimate.created_at as string,
    }))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  // Availability is only reduced by OPEN estimates (converted/billed ones already became sales).
  const reserved = reservations.filter((r) => r.status === "open").reduce((s, r) => s + r.qty, 0);

  // Unit price per movement (sale rate / purchase cost / estimate rate), variant-exact w/ fallback.
  const priceKey = (ref: string, vid: string | null) => `${ref}|${vid ?? ""}`;
  const priceBy = new Map<string, number>();
  if (saleRefs.length) {
    const { data: ois } = await sb.from("order_items").select("order_id,variant_id,unit_price").in("order_id", saleRefs as string[]).eq("product_id", productId);
    for (const oi of ((ois as any[]) ?? [])) {
      priceBy.set(priceKey(oi.order_id, oi.variant_id ?? null), oi.unit_price ?? 0);
      if (!priceBy.has(priceKey(oi.order_id, null))) priceBy.set(priceKey(oi.order_id, null), oi.unit_price ?? 0);
    }
  }
  if (purchaseRefs.length) {
    const { data: pis2 } = await sb.from("purchase_items").select("purchase_id,unit_cost").in("purchase_id", purchaseRefs as string[]).eq("mapped_product_id", productId);
    for (const pi of ((pis2 as any[]) ?? [])) priceBy.set(priceKey(pi.purchase_id, null), pi.unit_cost ?? 0);
  }

  // Real stock movements → display rows (carry the anchored running balance).
  const realDisplay: (LedgerMovement & { _seq?: number })[] = allRows.map((r, _i) => ({
    _seq: _i,
    id: r.id, kind: r.kind ?? "adjustment", delta: r.delta ?? 0, runningBalance: r.runningBalance ?? 0,
    source: r.source ?? null, reason: r.reason ?? null, created_by: r.created_by ?? r.source ?? null,
    ref_id: r.ref_id ?? null, created_at: r.created_at,
    invoice_no: r.kind === "sale" ? (invoiceBy.get(r.ref_id) ?? null) : r.kind === "purchase" ? (billBy.get(r.ref_id) ?? null) : null,
    party: r.ref_id ? (partyBy.get(r.ref_id) ?? null) : null,
    hold: false,
    variant: r.variant_id ? { color: variantById.get(r.variant_id)?.color ?? null, sku: variantById.get(r.variant_id)?.sku ?? null } : null,
    price: r.ref_id ? (priceBy.get(priceKey(r.ref_id, r.variant_id ?? null)) ?? priceBy.get(priceKey(r.ref_id, null)) ?? null) : null,
    variantBalance: (r.variantBalance as number | null) ?? null,
    doc: docFor(r),
  }));
  // Estimate holds → timeline rows. ONLY open estimates are soft-holds; a converted/cash-billed estimate
  // has already become a real 'sale' movement, so showing it again as "Reserved" was wrong and confusing
  // (owner: "Ruby/Green reserved dikha rha hai jabki estimate convert ho chuka hai"). Show holds for open only.
  // They do NOT change the running balance (soft commitment), so runningBalance stays null.
  const holdDisplay: LedgerMovement[] = resvRows.filter((r) => r.estimate.status === "open").map((r) => ({
    id: `est-${r.estimate.id}-${r.qty}-${r.estimate.created_at}`,
    kind: "estimate", delta: -(r.qty ?? 0), runningBalance: null,
    source: null, reason: `Reserved ${r.qty ?? 0} pcs · estimate ${r.estimate.status ?? ""}`.trim(),
    created_by: null, ref_id: r.estimate.id as string, created_at: r.estimate.created_at as string,
    invoice_no: null, party: (r.estimate.customer_name as string) ?? null, hold: true,
    variant: (r.variant?.color as string | null) ? { color: r.variant.color as string, sku: null } : null,
    price: (r.unit_price as number) ?? null,
    doc: { href: `/admin/estimate/${r.estimate.id}`, label: "Open estimate →" },
  }));

  // HONEST BASELINE: if the real stock (products.qty) differs from the sum of every logged
  // movement, that residual used to hide inside the first row's balance (an Opening of +21 would
  // mysteriously show "→ 23"). Surface it as an explicit OLDEST row instead, so the owner sees
  // exactly where stock existed without a logged movement (e.g. a direct stock edit / pre-ledger
  // count) and every row's before → change → after chains transparently.
  const residual = currentStock - deltaSum;
  const baselineRow: LedgerMovement[] = residual !== 0 && allRows.length > 0 ? [{
    id: "baseline",
    kind: "adjustment", delta: residual, runningBalance: residual,
    source: "Baseline", created_by: null, ref_id: null,
    reason: residual > 0
      ? `${residual} pc${residual === 1 ? "" : "s"} existed before/outside the logged movements (direct stock edit or pre-ledger count)`
      : `${Math.abs(residual)} pc${residual === -1 ? "" : "s"} left stock without a logged movement (direct stock edit)`,
    created_at: new Date(new Date(allRows[0].created_at).getTime() - 1000).toISOString(),
    invoice_no: null, party: null, hold: false, variant: null, price: null, doc: null,
  }] : [];

  // Combined newest-first timeline (real movements + estimate holds + baseline), sliced for lazy pagination.
  const timeline = [...realDisplay, ...holdDisplay, ...baselineRow]
    .sort((a, b) => {
      if (a.created_at < b.created_at) return 1;
      if (a.created_at > b.created_at) return -1;
      // Same instant (e.g. two lines of ONE bill): later ledger sequence stacks ON TOP, so the
      // whole timeline reads newest-first uniformly and balances chain downwards without zig-zags.
      return ((b as any)._seq ?? 0) - ((a as any)._seq ?? 0);
    });
  const totalMovements = timeline.length;
  const movements: LedgerMovement[] = timeline.slice(offset, offset + limit);

  // --- supplier + cost from purchase history ---
  const { data: pis } = await sb.from("purchase_items")
    .select("qty,unit_cost, purchase:purchases(created_at, supplier:suppliers(name))")
    .eq("mapped_product_id", productId);
  const piList = ((pis as any[]) ?? [])
    .map((r) => ({ qty: r.qty ?? 0, cost: r.unit_cost ?? 0, at: r.purchase?.created_at ?? null, supplier: r.purchase?.supplier?.name ?? null }))
    .sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));
  const lastPurchaseCost = piList[0]?.cost ?? null;
  const supplier = piList.find((p2) => p2.supplier)?.supplier ?? null;
  const totQty = piList.reduce((s, p2) => s + p2.qty, 0);
  const avgCost = totQty > 0 ? Math.round(piList.reduce((s, p2) => s + p2.cost * p2.qty, 0) / totQty) : (lastPurchaseCost ?? null);

  const lastSale = [...allRows].filter((r) => r.kind === "sale").slice(-1)[0]?.created_at ?? null;
  const lastPurchaseDate = [...allRows].filter((r) => r.kind === "purchase").slice(-1)[0]?.created_at ?? piList[0]?.at ?? null;

  // --- analytics roll-up ---
  const opening = allRows.filter((r) => r.kind === "opening").reduce((s, r) => s + (r.delta ?? 0), 0);
  const purchased = allRows.filter((r) => r.kind === "purchase").reduce((s, r) => s + Math.max(0, r.delta ?? 0), 0);
  const sold = allRows.filter((r) => r.kind === "sale").reduce((s, r) => s + Math.abs(Math.min(0, r.delta ?? 0)), 0);
  const returned = allRows.filter((r) => ["return", "purchase_return"].includes(r.kind)).reduce((s, r) => s + Math.abs(r.delta ?? 0), 0);
  const adjusted = allRows.filter((r) => ["adjustment", "damage", "correction"].includes(r.kind)).reduce((s, r) => s + (r.delta ?? 0), 0);
  const available = currentStock - reserved;
  const daysSinceLastSale = lastSale ? Math.floor((Date.now() - new Date(lastSale).getTime()) / 86400000) : null;
  const firstAt = allRows[0]?.created_at ? new Date(allRows[0].created_at) : null;
  const monthsActive = firstAt ? Math.max(1, (Date.now() - firstAt.getTime()) / (86400000 * 30)) : 1;
  const avgMonthlySales = Math.round(sold / monthsActive);
  const turnover = currentStock > 0 ? Math.round((sold / currentStock) * 100) / 100 : sold;

  return {
    header: {
      id: prod.id, sku: prod.sku, name: prod.name, image, category: prod.category?.name ?? null,
      supplier, currentStock, reserved, available, reorderLevel: prod.reorder_level ?? null,
      avgCost, lastPurchaseCost, lastSaleDate: lastSale, lastPurchaseDate,
    },
    analytics: { opening, purchased, sold, returned, adjusted, reserved, available, currentStock, daysSinceLastSale, turnover, avgMonthlySales },
    reservations,
    variants,
    movements,
    totalMovements,
    nextOffset: offset + limit < totalMovements ? offset + limit : null,
  };
}

export type ProductLedger = NonNullable<Awaited<ReturnType<typeof getProductLedger>>>;

// ---------- Product Management System (PIM) — full product aggregate by id ----------
import { resolvePrices as pimResolve, overridesOf as pimOverrides } from "../pricing";

/** Everything the /admin/products/[id] PIM page needs, in one call. Resilient to the 0029
 *  extension tables not being deployed yet (each optional read is guarded). */
export async function getProductForPim(id: string) {
  if (!id) return null;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("*, category:categories(id,name,slug)").eq("id", id).maybeSingle();
  if (!p) return null;
  const prod = p as any;

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => { try { return await fn(); } catch { return fallback; } };

  const [details, channelsRaw, variantsRaw, images, formula, reservations, categories, subcategories] = await Promise.all([
    safe(async () => (await sb.from("product_details").select("*").eq("product_id", id).maybeSingle()).data, null as any),
    safe(async () => (await sb.from("product_channel_settings").select("*").eq("product_id", id)).data ?? [], [] as any[]),
    safe(async () => (await sb.from("variants").select("*").eq("product_id", id).order("sku")).data ?? [], [] as any[]),
    safe(async () => (await sb.from("product_images").select("id,path,kind,sort,variant_id").eq("product_id", id).order("sort")).data ?? [], [] as any[]),
    getPricingFormula(),
    getProductEstimateReservations(id),
    getCategories(),
    safe(async () => (await sb.from("subcategories").select("id,name,slug,category_id")).data ?? [], [] as any[]),
  ]);

  const vIds = (variantsRaw as any[]).map((v) => v.id);
  const vcs = vIds.length
    ? await safe(async () => (await sb.from("variant_channel_settings").select("*").in("variant_id", vIds)).data ?? [], [] as any[])
    : [];

  // recent audit/history for this product (matched on SKU, which logActivity stores as `ref`)
  const audit = await safe(async () =>
    (await sb.from("audit_log").select("at,actor,action,ref,detail").eq("ref", prod.sku).order("at", { ascending: false }).limit(50)).data ?? [],
    [] as any[]);

  const channels = channelsRaw as any[];
  const reserved = (reservations as any[]).reduce((s, r) => s + (r.qty ?? 0), 0);
  const prices = pimResolve(prod.base_wholesale, formula, pimOverrides(prod));

  return {
    product: prod,
    details: details ?? null,
    channels: {
      retail: channels.find((c) => c.channel === "retail") ?? null,
      wholesale: channels.find((c) => c.channel === "wholesale") ?? null,
    },
    variants: (variantsRaw as any[]).map((v) => ({
      ...v,
      retailVisible: (vcs as any[]).find((x) => x.variant_id === v.id && x.channel === "retail")?.visible ?? true,
      wholesaleVisible: (vcs as any[]).find((x) => x.variant_id === v.id && x.channel === "wholesale")?.visible ?? true,
      prices: pimResolve(prod.base_wholesale, formula, pimOverrides(v), pimOverrides(prod)),
    })),
    images,
    formula,
    prices,
    reserved,
    available: (prod.qty ?? 0) - reserved,
    reservations,
    categories,
    subcategories,
    audit,
  };
}
export type ProductPim = NonNullable<Awaited<ReturnType<typeof getProductForPim>>>;

// ---------- AI Photography Studio — per-product raw + generations ----------
export async function getStudioData(productId: string) {
  if (!productId) return null;
  const sb = supabaseServer();
  const { data: p } = await sb.from("products").select("id,sku,name,status,thumbnail_path, category:categories(name,slug)").eq("id", productId).maybeSingle();
  if (!p) return null;
  const prod = p as any;
  const { data: imgs } = await sb.from("product_images").select("id,path,kind,sort,generation_id").eq("product_id", productId).order("sort");
  const { data: vars } = await sb.from("variants").select("id,sku,color,image_paths").eq("product_id", productId).order("sku");
  let generations: any[] = [];
  try { generations = (await sb.from("image_generations").select("*").eq("product_id", productId).order("created_at", { ascending: false })).data ?? []; } catch { generations = []; }
  const images = ((imgs as any[]) ?? []).filter((i) => typeof i.path === "string");
  const raw = images.find((i) => i.kind === "source" || i.kind === "flatlay") ?? null;
  const published = images.filter((i) => i.path.startsWith("http")).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const detected = generations.find((g) => g.detected)?.detected ?? null;
  const variants = ((vars as any[]) ?? []).map((v) => {
    const vImgs = (Array.isArray(v.image_paths) ? v.image_paths : []).filter((x: string) => typeof x === "string" && x.startsWith("http"));
    return { id: v.id, sku: v.sku, color: v.color ?? null, image: vImgs[0] ?? null, images: vImgs as string[] };
  });
  return { product: prod, raw, images: published, generations, variants, detected, thumbnailPath: prod.thumbnail_path ?? null };
}
export type StudioData = NonNullable<Awaited<ReturnType<typeof getStudioData>>>;

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
  const [ordersRes, prods, catRes, retRes, apprRes] = await Promise.all([
    sb.from("orders").select("total,channel,payment_mode,pay_cash,pay_bank,created_at,status,is_backorder").gte("created_at", fromISO).lte("created_at", toISO).or("is_backorder.is.null,is_backorder.eq.false").eq("cod_hold", false),
    fetchAll((f, t) => sb.from("products").select("sku,name,qty,last_movement_at,created_at,category:categories(name)").range(f, t)),
    sb.from("categories").select("id"),
    sb.from("retailers").select("id,approved"),
    sb.from("approvals").select("id,status"),
  ]);
  // Pending backorders (held, not sold) are already filtered above; also drop cancelled/refunded so
  // the dashboard revenue matches the sales record (owner: "revenue dikha raha hai but no stock movement").
  const orders = (ordersRes.data ?? []).filter((o: any) => o.status !== "cancelled" && o.status !== "refunded");
  const products = (prods as any[]) ?? [];

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

export type ClassifiedRow = { id: string; sku: string; name: string; category: string; categorySlug: string; status: string; qty: number; lastMovementAt: string | null; cls: string };

/** New reseller/dealer applications (from the /trade/login "Become a dealer" form) awaiting the owner's
 *  approval — surfaced on the dashboard so he can approve + issue an access code. */
export type DealerApplication = { id: string; name: string | null; phone: string | null; city: string | null; gstin: string | null; notes: string | null; created_at: string };
export async function getPendingDealerApplications(limit = 10): Promise<DealerApplication[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("customers")
    .select("id,name,phone,city,gstin,notes,created_at")
    .eq("type", "wholesale").eq("wholesale_approved", false)
    .ilike("notes", "%Dealer application%") // only real signup-form applications, not demo/manual entries
    .order("created_at", { ascending: false }).limit(limit);
  return ((data as any[]) ?? []) as DealerApplication[];
}

export type OrderAlertRow = { id: string; invoice_no: string | null; channel: string | null; status: string | null; total: number; amount_paid: number; customer_name: string | null; created_at: string };
/** Latest orders + a 24h count — powers the live "New Orders" panel + toast on the dashboard. */
export async function getOrderAlerts(limit = 8): Promise<{ orders: OrderAlertRow[]; last24h: number }> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [listRes, cntRes] = await Promise.all([
    sb.from("orders").select("id,invoice_no,channel,status,total,amount_paid,customer_name,created_at").order("created_at", { ascending: false }).limit(limit),
    sb.from("orders").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);
  return { orders: ((listRes.data as any[]) ?? []) as OrderAlertRow[], last24h: cntRes.count ?? 0 };
}

export type StorefrontOrderRow = { id: string; invoice_no: string | null; channel: string; status: string | null; total: number; amount_paid: number; payment_mode: string | null; customer_name: string | null; customer_phone: string | null; created_at: string; fulfillment?: string | null };
/** Orders placed BY CUSTOMERS on the storefront (retail / wholesale online) in the last 3 days — the ones
 *  the owner must actually see and fulfil. Kept separate from his own counter (POS) bills, which flood the
 *  general feed ~9×/day and bury the rare online order. */
export async function getStorefrontOrderAlerts(limit = 12): Promise<StorefrontOrderRow[]> {
  const sb = supabaseServer();
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from("orders")
    .select("id,invoice_no,channel,status,total,amount_paid,payment_mode,customer_name,customer_phone,created_at,fulfillment")
    .in("channel", ["retail", "wholesale"])
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(40);
  return ((data as any[]) ?? [])
    .filter((o) =>
      // Only orders that STILL NEED action stay in the "pack & ship" box. Once the owner accepts / dispatches
      // / delivers / rejects an order it has been handled and must drop off this list (owner: "accepted orders
      // are not moving out from here"). A new order has status 'completed' but NO fulfilment set yet.
      !["cancelled", "refunded", "dispatched", "delivered", "shipped"].includes(String(o.status ?? "").toLowerCase())
      && ["", "new", "pending"].includes(String(o.fulfillment ?? "").toLowerCase())
      // Wholesale PREPAID orders live in their own "Wholesale payments to verify" box (with Accept/Reject),
      // so don't repeat them here. This box is for orders with no other home: all retail, plus wholesale-COD.
      && (o.channel === "retail" || String(o.payment_mode ?? "").toLowerCase() === "cod"))
    .slice(0, limit) as StorefrontOrderRow[];
}

export async function getInventoryClassified(rule: InventoryRule = DEFAULT_RULE): Promise<ClassifiedRow[]> {
  const sb = supabaseServer();
  const data = await fetchAll((f, t) => sb.from("products").select("id,sku,name,qty,status,last_movement_at,category:categories(name,slug)").order("sku").range(f, t));
  const now = new Date();
  return ((data as any[]) ?? []).map((p) => ({
    id: p.id, sku: p.sku, name: p.name, category: p.category?.name ?? "—", categorySlug: p.category?.slug ?? "all",
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

// ---------- promotional posters / festive campaigns (0036) ----------
export type Promotion = { id: string; title: string | null; image_path: string; cta_href: string | null; aspect: string | null; category?: { slug?: string; name?: string } | null };

/** Published promo posters for a storefront scope, newest first. */
/** Live promos for a scope + placement, respecting the schedule window (starts_at/ends_at). */
export async function getLivePromos(scope: "retail" | "wholesale", placement: "hero" | "popup" | "strip"): Promise<any[]> {
  const sb = supabaseServer();
  const now = new Date().toISOString();
  let q = sb.from("promotions")
    .select("id,title,image_path,cta_href,cta_label,aspect,media_type,placement,headline,subtext,discount_code,starts_at,ends_at, category:categories(slug,name)")
    .eq("status", "published").eq("placement", placement)
    .or(`starts_at.is.null,starts_at.lte.${now}`)
    .or(`ends_at.is.null,ends_at.gte.${now}`)
    .order("created_at", { ascending: false });
  q = scope === "retail" ? q.eq("show_retail", true) : q.eq("show_wholesale", true);
  const { data } = await q;
  const rows = ((data as any[]) ?? []);
  // Hero & popup need a creative; strip is text-only.
  return placement === "strip" ? rows : rows.filter((p) => typeof p.image_path === "string" && p.image_path.startsWith("http"));
}

export async function getActivePromotions(scope: "retail" | "wholesale"): Promise<Promotion[]> {
  return (await getLivePromos(scope, "hero")) as Promotion[];
}

/** Admin: every campaign for the promotions page. */
export async function getPromotionsAdmin() {
  const sb = supabaseServer();
  const { data } = await sb.from("promotions").select("*, category:categories(slug,name)").order("created_at", { ascending: false }).limit(60);
  return ((data as any[]) ?? []);
}

// ============================================================================================
// RESULT-CACHED heavy loaders — the main fix for a slow admin. Billing / Estimates / Purchases were
// re-reading the ENTIRE catalogue (~4.5k products + ~12k variants + images + customers, 20+ paginated
// round-trips) on EVERY open, because supabaseServer() forces `no-store`. These wrap the same reads in
// unstable_cache: computed once, reused for ~30s, and tagged "storefront"/"customers" so any product /
// stock / price / customer change (which calls revalidateTag) refreshes them immediately. The POS
// "live SKU lookup" still hits the DB directly, so a brand-new SKU is always billable at once — a short
// cache is safe. Result: repeat admin navigation is near-instant instead of multi-second.
// ============================================================================================

/** Cached storefront (per-opts). Use on admin POS/estimate pages that don't need to-the-second freshness. */
export const getStorefrontCached = (opts: { includeDrafts?: boolean; includeWholesaleOnly?: boolean; excludeRetailOnly?: boolean } = {}) =>
  unstable_cache(() => getStorefront(opts), ["storefront-cached", JSON.stringify(opts)], { tags: ["storefront"], revalidate: 30 })();

/** ALL variant SKUs (colour + stock + price overrides) for the billing/estimate counters — 12k+ rows. */
export const getBillingVariants = unstable_cache(async (): Promise<any[]> => {
  const sb = supabaseServer();
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await sb.from("variants").select("sku,color,qty,product_id,wholesale_override,retail_override,mrp_override").order("product_id", { ascending: true }).range(from, from + 999);
    const batch = (data as any[]) ?? [];
    rows.push(...batch);
    if (batch.length < 1000) break;
  }
  return rows;
}, ["billing-variants"], { tags: ["storefront"], revalidate: 30 });

/** Cached full customer directory for the POS/estimate customer picker. */
export const getCustomersDbCached = unstable_cache(() => getCustomersDb({}), ["customers-all"], { tags: ["customers"], revalidate: 30 });

/** Cached products+variants for the purchase-entry screen. */
export const getProductsForPurchaseCached = unstable_cache(() => getProductsForPurchase(), ["products-for-purchase"], { tags: ["storefront"], revalidate: 30 });

/** Cached category tree + live promos — these run in the retail LAYOUT on every storefront navigation
 *  (header menu + footer + promo strip). They're identical for every visitor and rarely change, so
 *  memoising them removes 3 DB round-trips per page load and makes navigation feel instant. Any catalogue
 *  or promo edit calls revalidateTag("storefront") and refreshes them at once. */
export const getCategoryTreeCached = unstable_cache(() => getCategoryTree(), ["category-tree"], { tags: ["storefront"], revalidate: 300 });

// Shareable catalogue (/catalog) reads were UNCACHED (supabaseServer is no-store), so every share view
// re-ran the heavy RICH query (all in-stock products + images + labels joins) — slow, and prone to timing
// out on a big collection. Cache per filter-set (5 min, busted by the "storefront" tag on any edit) so a
// shared link opens fast for the customer instead of re-querying the whole catalogue each time.
export const getCatalogProductsCached = (opts: Parameters<typeof getCatalogProducts>[0]) =>
  unstable_cache(() => getCatalogProducts(opts), ["catalog-products", JSON.stringify(opts)], { tags: ["storefront"], revalidate: 300 })();
export const getCatalogSuggestionsCached = unstable_cache(() => getCatalogSuggestions(), ["catalog-suggestions"], { tags: ["storefront"], revalidate: 600 });
export const getLivePromosCached = (scope: "retail" | "wholesale", placement: "hero" | "popup" | "strip") =>
  unstable_cache(() => getLivePromos(scope, placement), ["live-promos", scope, placement], { tags: ["storefront"], revalidate: 120 })();

export async function getStorefront(
  opts: { includeDrafts?: boolean; includeWholesaleOnly?: boolean; excludeRetailOnly?: boolean; onlyInStock?: boolean } = {},
): Promise<{ products: StoreProduct[]; formula: PF }> {
  const sb = supabaseServer();
  // D2C-safe defaults: only published, and never wholesale-only items (#1, #23).
  // NOTE: products / images / variants all exceed PostgREST's 1000-row cap — page through them.
  // PERF: select ONLY the columns the storefront actually renders — crucially NOT `generated_content`
  // (the AI copy blob, ~78% of each row) or `embedding` (the search vector). The whole in-stock catalogue
  // is cached and re-parsed on every page render; dropping those two blobs shrinks that cached payload by
  // ~4× so every storefront page (home, category, search) deserializes and renders much faster.
  const STOREFRONT_COLS =
    "id, category_id, sku, name, type, base_wholesale, qty, status, last_movement_at, created_at, " +
    "subcategory_id, wholesale_override, retail_override, mrp_override, wholesale_only, retail_only, " +
    "style_id, thumbnail_path, default_variant_id, hide_oos_variants, in_stock, more_designs, more_designs_note, " +
    "category:categories(id,name,slug)";
  const [prods, revs, pimgs, vimgs, formula] = await Promise.all([
    fetchAll((f, t) => {
      let q = sb.from("products").select(STOREFRONT_COLS).order("sku");
      if (!opts.includeDrafts) q = q.eq("status", "published");
      return q.range(f, t);
    }),
    sb.from("reviews").select("product_id, rating").then((r) => r.data ?? []),
    fetchAll((f, t) => sb.from("product_images").select("product_id, path, sort, kind").order("sort", { ascending: true }).range(f, t)),
    fetchAll((f, t) => sb.from("variants").select("id, product_id, image_paths, qty").range(f, t)),
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
    if (!isStorefrontImage(r.kind)) continue; // hide the raw upload — only AI-generated images on the shop
    if (!imgByProduct.has(r.product_id)) imgByProduct.set(r.product_id, r.path);
  }
  // Every VALID image URL a product currently owns (product images + variant images). Used to
  // auto-heal a stale cover: if the owner deletes the photo that thumbnail_path pointed at, that
  // pinned cover no longer matches any real image, so we ignore it and fall back — the "deleted
  // everywhere but the cover still shows" bug.
  const validImgs = new Map<string, Set<string>>();
  const addValid = (pid: string, url: string) => { let s = validImgs.get(pid); if (!s) { s = new Set(); validImgs.set(pid, s); } s.add(url); };
  for (const r of (pimgs as any[]) ?? []) if (typeof r.path === "string" && r.path.startsWith("http")) addValid(r.product_id, r.path);
  const vlist = (vimgs as any[]) ?? [];
  for (const v of vlist) for (const u of ((v.image_paths as string[]) ?? [])) if (typeof u === "string" && u.startsWith("http")) addValid(v.product_id, u);
  // Card cover fallback: prefer an IN-STOCK colour's photo so a card never leads with a sold-out
  // colour, then fall back to any colour's photo.
  const firstHttp = (v: any) => ((v.image_paths as string[]) ?? []).find((x) => x && x.startsWith("http"));
  // Per-variant lookup (by id) so the owner's DEFAULT colour can lead the cover everywhere.
  const varById = new Map<string, { qty: number; img: string | null }>();
  for (const v of vlist) varById.set(v.id, { qty: v.qty ?? 0, img: firstHttp(v) ?? null });
  for (const v of vlist) { if (imgByProduct.has(v.product_id) || (v.qty ?? 0) <= 0) continue; const u = firstHttp(v); if (u) imgByProduct.set(v.product_id, u); }
  for (const v of vlist) { if (imgByProduct.has(v.product_id)) continue; const u = firstHttp(v); if (u) imgByProduct.set(v.product_id, u); }
  // Which variant images belong to a colour, and which to an IN-STOCK colour — so a product that hides
  // out-of-stock colours never leads its card with a sold-out colour's photo (even a pinned thumbnail).
  const varImgs = new Map<string, Set<string>>();
  const inStockImgs = new Map<string, Set<string>>();
  for (const v of vlist) for (const u of ((v.image_paths as string[]) ?? [])) {
    if (typeof u !== "string" || !u.startsWith("http")) continue;
    { let s = varImgs.get(v.product_id); if (!s) { s = new Set(); varImgs.set(v.product_id, s); } s.add(u); }
    if ((v.qty ?? 0) > 0) { let s = inStockImgs.get(v.product_id); if (!s) { s = new Set(); inStockImgs.set(v.product_id, s); } s.add(u); }
  }
  const now = Date.now();
  let products = ((prods as any[]) ?? []).map((p) => {
    const a = agg.get(p.id);
    const rating = a && a.n ? a.sum / a.n : 4.6;
    const reviews = a?.n ?? 0;
    const isNew = p.created_at ? now - new Date(p.created_at).getTime() < 1000 * 60 * 60 * 24 * 21 : false;
    // Cover priority: (1) the owner's DEFAULT colour's lead photo (if in stock) — so the card, catalogue
    // and product page all show the SAME picture the owner set as default; (2) a pinned thumbnail that
    // still exists and isn't a sold-out colour; (3) any in-stock colour's photo.
    const dv = p.default_variant_id ? varById.get(p.default_variant_id) : undefined;
    const defImg = (dv && dv.qty > 0 && dv.img) ? dv.img : null;
    const tp = (typeof p.thumbnail_path === "string" && p.thumbnail_path.startsWith("http") && validImgs.get(p.id)?.has(p.thumbnail_path)) ? p.thumbnail_path : null;
    const tpIsOosColour = !!tp && (varImgs.get(p.id)?.has(tp) ?? false) && !(inStockImgs.get(p.id)?.has(tp) ?? false);
    const cover = defImg ?? ((tp && !tpIsOosColour) ? tp : null);
    return { ...p, image: cover ?? imgByProduct.get(p.id) ?? null, rating: Math.round(rating * 10) / 10, reviews, isNew };
  });
  if (!opts.includeWholesaleOnly) products = products.filter((p: any) => !p.wholesale_only);
  // Wholesale storefront hides retail-only items (admin/POS pass excludeRetailOnly=false → see all).
  if (opts.excludeRetailOnly) products = products.filter((p: any) => !p.retail_only);
  // HIDE SOLD-OUT DESIGNS from the storefront (owner: "bhot sare out of stock products visible"). A design
  // is in stock when it has at least one piece: for a design with colours that means the colour quantities
  // add up to > 0; for a plain design it's its own qty. Total stock is read from the VARIANTS (the
  // authoritative per-colour count) so a stale product.qty can't keep a sold-out design on the shelf.
  if (opts.onlyInStock) {
    const varSum = new Map<string, number>();
    const hasVar = new Set<string>();
    for (const v of vlist) { hasVar.add(v.product_id); varSum.set(v.product_id, (varSum.get(v.product_id) ?? 0) + (v.qty ?? 0)); }
    products = products.filter((p: any) => (hasVar.has(p.id) ? (varSum.get(p.id) ?? 0) : (p.qty ?? 0)) > 0);
  }
  return { products, formula };
}

export type FeaturedReview = { id: string; author_name: string; rating: number; body: string; image_url: string | null };
export async function getFeaturedReviews(): Promise<FeaturedReview[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("reviews").select("id,author_name,rating,body,image_url").gte("rating", 4).order("created_at", { ascending: false }).limit(30);
  const rows = ((data as any[]) ?? []).map((r) => ({ id: r.id, author_name: r.author_name, rating: r.rating, body: r.body, image_url: (r.image_url as string) ?? null }));
  // Photo reviews look best on the homepage — surface those first, then the rest, capped at 6.
  rows.sort((a, b) => (b.image_url ? 1 : 0) - (a.image_url ? 1 : 0));
  return rows.slice(0, 6);
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
  // Count only REAL sales: exclude CANCELLED / REFUNDED orders and PENDING backorders (held like an
  // estimate — no stock moved, no revenue posted). Otherwise a cancelled bill wrongly shows units &
  // revenue on the product even though its "history" has no stock movement (owner's confusion).
  const { data } = await sb.from("order_items")
    .select("qty,line_total, orders(status,is_backorder,cod_hold)")
    .eq("product_id", (p as any).id);
  const rows = ((data as any[]) ?? []).filter((r) => {
    const o = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    if (!o) return false;
    return o.status !== "cancelled" && o.status !== "refunded" && !o.is_backorder && !o.cod_hold;
  });
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
  // Join the VARIANT too (sku + colour) so the printed bill shows exactly what was sold — e.g.
  // "…Necklace Set – Navy Blue" with SKU KN5441-NBlue (the "green not showing" issue). Resilient:
  // if the variant embed can't resolve, fall back to product-only so the invoice never blanks.
  const RICH = "qty,unit_price,unit_mrp,line_total,product:products(name,sku),variant:variants(sku,color)";
  const BASIC = "qty,unit_price,unit_mrp,line_total,product:products(name,sku)";
  const rich = await sb.from("order_items").select(RICH).eq("order_id", id);
  let items: any[] | null = (rich.data as any) ?? null;
  if (rich.error || items == null) {
    const basic = await sb.from("order_items").select(BASIC).eq("order_id", id);
    items = (basic.data as any) ?? null;
  }
  return { order, items: items ?? [] };
}

/** Customer order tracking — looked up by order id (full or first 8 chars of the UUID, or the
 *  invoice number) AND the phone used on the order, so no one can browse others' orders. */
export async function getOrderTracking(idOrInvoice: string, phoneRaw: string) {
  const sb = supabaseServer();
  const key = (idOrInvoice ?? "").trim();
  const phone = (phoneRaw ?? "").replace(/\D/g, "").slice(-10);
  if (key.length < 4 || phone.length !== 10) return { error: "bad_input" as const };
  const SEL = "id,invoice_no,status,fulfillment,total,payment_mode,customer_name,customer_phone,courier_name,tracking_no,tracking_url,dispatched_at,delivered_at,created_at";
  // Match on invoice number, full UUID, or the short 8-char code shown to the customer.
  let order: any = null;
  const looksUuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i.test(key);
  if (looksUuid) {
    order = (await sb.from("orders").select(SEL).eq("id", key).maybeSingle()).data;
  } else {
    const byInv = (await sb.from("orders").select(SEL).ilike("invoice_no", key).limit(1)).data as any[];
    order = byInv?.[0] ?? null;
    if (!order && /^[0-9a-f]{8}$/i.test(key)) {
      // Short code (first 8 of the UUID) — scan recent orders for a prefix match.
      const recent = (await sb.from("orders").select(SEL).order("created_at", { ascending: false }).limit(1000)).data as any[];
      order = (recent ?? []).find((o) => String(o.id).slice(0, 8).toLowerCase() === key.toLowerCase()) ?? null;
    }
  }
  if (!order) return { error: "not_found" as const };
  const onOrder = String(order.customer_phone ?? "").replace(/\D/g, "").slice(-10);
  if (onOrder !== phone) return { error: "not_found" as const };
  const { data: items } = await sb.from("order_items")
    .select("qty,line_total,product:products(name,sku),variant:variants(sku,color)").eq("order_id", order.id);
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
  const { data: items } = await sb.from("estimate_items").select("id,qty,unit_price,line_total,product:products(name,sku),variant:variants(sku,color)").eq("estimate_id", id);
  // A–Z by SKU at the source, so EVERY consumer — the estimate view, the editor, the print/PDF, and the
  // bill it converts into — lists lines in the same predictable order regardless of scan sequence
  // (owner: "estimate me save karne pe A-Z chahiye"). Numeric-aware so KPKN2 sorts before KPKN10.
  const sortedItems = ((items as any[]) ?? []).sort((a, b) =>
    String(a.variant?.sku ?? a.product?.sku ?? "").localeCompare(String(b.variant?.sku ?? b.product?.sku ?? ""), undefined, { numeric: true }));
  return { estimate, items: sortedItems };
}
export async function getRecentOrders(limit = 12) {
  const sb = supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,total,channel,payment_mode,customer_name,created_at,order_items(qty,product:products(id,name,sku),variant:variants(sku,color))")
    .order("created_at", { ascending: false }).limit(limit);
  return (data as any[]) ?? [];
}
export async function getReturns() {
  const sb = supabaseServer();
  const { data } = await sb.from("returns").select("id,kind,reason,qty,created_at").order("created_at", { ascending: false }).limit(20);
  return (data as any[]) ?? [];
}

/** The Returns module's full picture — SALES and PURCHASE returns together, each with:
 *  the bill it was made against (invoice / purchase bill, linkable), the party (customer /
 *  supplier), the money value (credit or debit note), and EVERY line with its VARIANT colour.
 *  Lines link via stock_adjustments.return_id (migration 0050); legacy rows (recorded before the
 *  linkage existed) fall back to a ±20s window on the same bill so history still shows its items. */
export async function getReturnsDetailed(limit = 40): Promise<{
  id: string; kind: string; refId: string | null; billRef: string; billHref: string | null;
  noteHref: string;
  party: string; qty: number; amount: number; reason: string | null; created_at: string;
  lines: { sku: string | null; color: string | null; qty: number }[];
}[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("returns")
    .select("id,kind,ref_order_id,reason,qty,amount,created_at,party")
    .order("created_at", { ascending: false }).limit(limit);
  const rets = (data as any[]) ?? [];
  if (!rets.length) return [];

  const retIds = rets.map((r) => r.id);
  const saleRefs = [...new Set(rets.filter((r) => r.kind === "sales" && r.ref_order_id).map((r) => r.ref_order_id))];
  const purchRefs = [...new Set(rets.filter((r) => r.kind === "purchase" && r.ref_order_id).map((r) => r.ref_order_id))];
  const allRefs = [...saleRefs, ...purchRefs];

  // Movements are linked either by the bill they came from (ref_id) OR directly by return_id — the
  // latter is how an OPEN return (goods back without a bill) records its lines. Fetch both, else a
  // bill-less return would show an empty item list in the register.
  const [{ data: moves }, { data: ords }, { data: purs }] = await Promise.all([
    (allRefs.length || retIds.length)
      ? sb.from("stock_adjustments").select("ref_id,return_id,sku,delta,created_at, variant:variants(color)")
          .in("kind", ["return", "purchase_return"])
          .or(`return_id.in.(${retIds.join(",")})${allRefs.length ? `,ref_id.in.(${allRefs.join(",")})` : ""}`)
      : Promise.resolve({ data: [] as any[] }),
    saleRefs.length ? sb.from("orders").select("id,invoice_no,customer_name").in("id", saleRefs) : Promise.resolve({ data: [] as any[] }),
    purchRefs.length ? sb.from("purchases").select("id,bill_no, supplier:suppliers(name)").in("id", purchRefs) : Promise.resolve({ data: [] as any[] }),
  ]);
  const ordBy = new Map(((ords as any[]) ?? []).map((o) => [o.id, o]));
  const purBy = new Map(((purs as any[]) ?? []).map((p) => [p.id, p]));
  const allMoves = ((moves as any[]) ?? []);

  return rets.map((r) => {
    // Exact linkage first; legacy fallback = same bill within ±20s of the return record.
    const t = new Date(r.created_at).getTime();
    let mv = allMoves.filter((m) => m.return_id === r.id);
    if (!mv.length) mv = allMoves.filter((m) => !m.return_id && m.ref_id === r.ref_order_id && Math.abs(new Date(m.created_at).getTime() - t) < 20000);
    const lines = mv.map((m) => ({ sku: (m.sku as string | null) ?? null, color: (m.variant?.color as string | null) ?? null, qty: Math.abs(m.delta ?? 0) }));
    const o = r.kind === "sales" ? ordBy.get(r.ref_order_id) : null;
    const p = r.kind === "purchase" ? purBy.get(r.ref_order_id) : null;
    return {
      id: r.id as string, kind: r.kind as string, refId: (r.ref_order_id as string | null) ?? null,
      // A return with no bill is a legitimate case (marketplace stock coming back), not missing data —
      // label it plainly so the register reads honestly instead of showing a blank reference.
      billRef: (o?.invoice_no as string) || (p?.bill_no as string) || (r.ref_order_id ? String(r.ref_order_id).slice(0, 8).toUpperCase() : "No bill"),
      billHref: r.ref_order_id ? (r.kind === "sales" ? `/admin/invoice/${r.ref_order_id}` : `/admin/purchase/${r.ref_order_id}`) : `/admin/returns/${r.id}`,
      noteHref: `/admin/returns/${r.id}`,
      party: (o?.customer_name as string) || (p?.supplier?.name as string) || (r.party as string) || "—",
      qty: (r.qty as number) ?? 0, amount: (r.amount as number) ?? 0,
      reason: (r.reason as string | null) ?? null, created_at: r.created_at as string,
      lines,
    };
  });
}

/** One return as a shareable debit/credit note — lines from stock_adjustments.return_id (and
 *  audit_log line costs for open purchase returns). Used by /admin/returns/[id]. */
export async function getReturnNote(id: string): Promise<{
  ret: { id: string; kind: string; ref_order_id: string | null; party: string | null; reason: string | null; qty: number; amount: number; created_at: string };
  billRef: string | null; billHref: string | null;
  supplier: { id: string; name: string; phone: string | null; gstin: string | null; address: string | null; city: string | null } | null;
  lines: { sku: string; name: string; color: string | null; qty: number; unitCost: number; lineTotal: number }[];
} | null> {
  const sb = supabaseServer();
  const { data: row } = await sb.from("returns").select("id,kind,ref_order_id,party,reason,qty,amount,created_at").eq("id", id).maybeSingle();
  if (!row) return null;
  const ret = row as any;

  const rich = await sb.from("stock_adjustments")
    .select("sku,delta,reason,product_id,variant_id,created_at, variant:variants(color,sku), product:products(name,sku)")
    .eq("return_id", id)
    .in("kind", ["return", "purchase_return"]);
  let mv = ((rich.data as any[]) ?? []);
  if (rich.error) {
    const basic = await sb.from("stock_adjustments")
      .select("sku,delta,reason,product_id,variant_id,created_at")
      .eq("return_id", id)
      .in("kind", ["return", "purchase_return"]);
    mv = ((basic.data as any[]) ?? []);
  }
  if (!mv.length && ret.ref_order_id) {
    const kind = ret.kind === "purchase" ? "purchase_return" : "return";
    const { data: byRef } = await sb.from("stock_adjustments")
      .select("sku,delta,reason,product_id,variant_id,created_at, variant:variants(color,sku), product:products(name,sku)")
      .eq("ref_id", ret.ref_order_id).eq("kind", kind);
    const t = new Date(ret.created_at).getTime();
    mv = ((byRef as any[]) ?? []).filter((m) => Math.abs(new Date(m.created_at).getTime() - t) < 20000);
  }

  const costBySku = new Map<string, number>();
  const { data: audit } = await sb.from("audit_log").select("detail").eq("ref", id).eq("action", "purchase_return").order("created_at", { ascending: false }).limit(1);
  try {
    const d = JSON.parse(String(((audit as any[]) ?? [])[0]?.detail ?? "{}"));
    for (const l of (d.lines ?? [])) {
      if (l?.sku && Number(l.unit_cost) > 0) costBySku.set(String(l.sku).toUpperCase(), Number(l.unit_cost));
    }
  } catch { /* ignore */ }

  if (ret.kind === "purchase" && ret.ref_order_id) {
    const { data: pItems } = await sb.from("purchase_items")
      .select("unit_cost,mapped_product_id,variant_id, product:products(sku), variant:variants(sku)")
      .eq("purchase_id", ret.ref_order_id);
    for (const it of ((pItems as any[]) ?? [])) {
      const sku = String(it.variant?.sku || it.product?.sku || "").toUpperCase();
      if (sku && Number(it.unit_cost) > 0) costBySku.set(sku, Number(it.unit_cost));
    }
  }

  const lines = mv.map((m) => {
    const sku = String(m.sku || m.variant?.sku || m.product?.sku || "").trim();
    const qty = Math.abs(m.delta ?? 0);
    const unitCost = costBySku.get(sku.toUpperCase()) ?? 0;
    return {
      sku: sku || "—",
      name: (m.product?.name as string) || sku || "—",
      color: (m.variant?.color as string | null) ?? null,
      qty,
      unitCost,
      lineTotal: unitCost * qty,
    };
  });

  // If movements didn't carry costs but the header has an amount, spread it so the note still totals.
  const lined = lines.reduce((s, l) => s + l.lineTotal, 0);
  if (lined === 0 && (ret.amount ?? 0) > 0 && lines.length) {
    const q = lines.reduce((s, l) => s + l.qty, 0) || 1;
    const per = Math.round((ret.amount as number) / q);
    for (const l of lines) { l.unitCost = per; l.lineTotal = per * l.qty; }
  }

  let billRef: string | null = null;
  let billHref: string | null = null;
  let supplier: { id: string; name: string; phone: string | null; gstin: string | null; address: string | null; city: string | null } | null = null;

  if (ret.kind === "purchase" && ret.ref_order_id) {
    const { data: p } = await sb.from("purchases").select("id,bill_no, supplier:suppliers(id,name,phone,gstin,address,city)").eq("id", ret.ref_order_id).maybeSingle();
    if (p) {
      billRef = (p as any).bill_no || String((p as any).id).slice(0, 8).toUpperCase();
      billHref = `/admin/purchase/${(p as any).id}`;
      const s = (p as any).supplier;
      if (s) supplier = { id: s.id, name: s.name, phone: s.phone ?? null, gstin: s.gstin ?? null, address: s.address ?? null, city: s.city ?? null };
    }
  } else if (ret.kind === "sales" && ret.ref_order_id) {
    const { data: o } = await sb.from("orders").select("id,invoice_no").eq("id", ret.ref_order_id).maybeSingle();
    if (o) {
      billRef = (o as any).invoice_no || String((o as any).id).slice(0, 8).toUpperCase();
      billHref = `/admin/invoice/${(o as any).id}`;
    }
  }

  if (!supplier && ret.party) {
    const { data: s } = await sb.from("suppliers").select("id,name,phone,gstin,address,city").ilike("name", ret.party).maybeSingle();
    if (s) supplier = s as any;
  }

  return {
    ret: {
      id: ret.id, kind: ret.kind, ref_order_id: ret.ref_order_id ?? null,
      party: ret.party ?? null, reason: ret.reason ?? null,
      qty: ret.qty ?? 0, amount: ret.amount ?? 0, created_at: ret.created_at,
    },
    billRef, billHref, supplier, lines,
  };
}

// ---------- purchases ----------
export async function getSuppliers() {
  const sb = supabaseServer();
  const { data } = await sb.from("suppliers").select("id,name,city").order("city");
  return (data as any[]) ?? [];
}
export async function getProductsLite() {
  const sb = supabaseServer();
  const data = await fetchAll((f, t) => sb.from("products").select("id,name,sku").order("sku").range(f, t));
  return (data as any[]) ?? [];
}

/** Products plus their variants — for purchase entry where stock can land on a specific variant. */
export async function getProductsForPurchase() {
  const sb = supabaseServer();
  const data = await fetchAll((f, t) => sb.from("products").select("id,name,sku, variants(id,sku,color,size,polish)").order("sku").range(f, t));
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
  // Show the variant (colour + variant SKU) alongside the mapped product. Resilient: if the variant
  // embed isn't available on a given DB, fall back to the product-only select so nothing blanks.
  const RICH_PI = "id,supplier_sku,qty,unit_cost,mapped_product_id, product:products(sku,name), variant:variants(sku,color)";
  const BASIC_PI = "id,supplier_sku,qty,unit_cost,mapped_product_id, product:products(sku,name)";
  const richPi = await sb.from("purchase_items").select(RICH_PI).eq("purchase_id", id);
  let items: any[] | null = (richPi.data as any) ?? null;
  if (richPi.error || items == null) {
    const basicPi = await sb.from("purchase_items").select(BASIC_PI).eq("purchase_id", id);
    items = (basicPi.data as any) ?? null;
  }
  const { data: pending } = await sb.from("approvals").select("id").eq("action", "delete_purchase").eq("status", "pending").contains("payload", { purchase_id: id }).maybeSingle();
  const { data: suppliers } = await sb.from("suppliers").select("id,name,city").order("name");
  // Products list for re-mapping any unmapped line (owner picks the design the supplier item is).
  const hasUnmapped = ((items as any[]) ?? []).some((it: any) => !it.mapped_product_id);
  const products = hasUnmapped
    ? await fetchAll((f, t) => sb.from("products").select("id,name,sku").order("sku").range(f, t))
    : ([] as any[]);
  return { purchase: p, items: items ?? [], deletionPending: !!pending, suppliers: (suppliers as any[]) ?? [], products: (products as any[]) ?? [] };
}

// Search ran getStorefront() UNCACHED on every keystroke-submit (force-dynamic page), re-reading the whole
// catalogue each time — so searching felt as slow as a cold shop load. The in-stock catalogue is identical
// for every shopper, so cache it (5 min, refreshed instantly by the "storefront" tag on any stock/price/
// product edit) and just filter in memory. Search is now near-instant.
const getSearchCatalogue = unstable_cache(
  () => getStorefront({ onlyInStock: true }),
  ["search-catalogue-instock"],
  { revalidate: 300, tags: ["storefront"] },
);

export async function searchProducts(q: string) {
  const { products, formula } = await getSearchCatalogue();
  // Match EVERY word the shopper typed, in any order (name + category + sku), so "prisha gold watch"
  // finds "Prisha Floral Design Gold Watch" — a single contiguous match would miss it.
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = tokens.length
    ? products.filter((p) => {
        const hay = (p.name + " " + p.category.name + " " + p.sku).toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
    : [];
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
  const data = await fetchAll((f, t) =>
    sb.from("orders").select("customer_name,customer_phone,total,bill_type,gst_mode,status,is_backorder,cod_hold,created_at").range(f, t));
  const map = new Map<string, { name: string; phone: string | null; orders: number; spent: number; last: string }>();
  for (const o of data as any[]) {
    const name = (o.customer_name ?? "").trim(); if (!name) continue;
    if (isWalkInPlaceholder(name, o.customer_phone)) continue;
    if (!isLiveSale(o)) continue;
    const key = directoryNameKey(name);
    const grand = billGrandPaise(o);
    const c = map.get(key) ?? { name, phone: o.customer_phone ?? null, orders: 0, spent: 0, last: o.created_at };
    c.orders++; c.spent += grand; if (o.created_at > c.last) c.last = o.created_at; if (!c.phone) c.phone = o.customer_phone ?? null;
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => b.spent - a.spent);
}
export async function getRetailers() {
  const sb = supabaseServer();
  const { data } = await sb.from("retailers").select("id,name,city,approved").order("name");
  return (data as any[]) ?? [];
}

/** Wholesale orders AWAITING the owner's payment verification: a dealer has placed a prepaid order
 *  (and usually uploaded a payment screenshot) but the money isn't marked received yet. This powers
 *  the owner's "Wholesale payments to approve" dashboard — screenshot on the left, Approve/Reject. */
export async function getPendingWholesalePayments(): Promise<{
  id: string; invoice_no: string | null; customer_name: string | null; customer_phone: string | null;
  total: number; amount_paid: number; payment_ref: string | null; proofUrl: string | null; created_at: string;
  items: { name: string; sku: string | null; qty: number; image: string | null }[];
}[]> {
  const sb = supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,invoice_no,customer_name,customer_phone,total,amount_paid,payment_ref,payment_proof_path,payment_mode,created_at, order_items(qty, product:products(name,sku), variant:variants(sku,color))")
    .eq("channel", "wholesale")
    .not("status", "in", "(cancelled,refunded)")
    .neq("payment_mode", "cod")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = ((data as any[]) ?? []).filter((o) => Math.max(0, (o.amount_paid ?? 0)) < (o.total ?? 0));

  // Resolve a thumbnail per line so the approval card reads as a list with photos, not a cramped
  // comma line — the owner verifies WHAT he's shipping at a glance. Variant colour photo, else parent.
  const imgByUpper = new Map<string, string>();
  const allSkus = Array.from(new Set(rows.flatMap((o: any) =>
    ((o.order_items as any[]) ?? []).flatMap((it: any) => [it.variant?.sku, it.product?.sku].filter(Boolean)))));
  if (allSkus.length) {
    const firstHttp = (arr: any[]) => (arr ?? []).filter((i: any) => typeof i?.path === "string" && i.path.startsWith("http")).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.path as string | undefined;
    const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
    for (const grp of chunk(allSkus as string[], 60)) {
      const or = grp.map((s) => `sku.ilike.${String(s).replace(/[,()]/g, "")}`).join(",");
      const [{ data: vs }, { data: ps }] = await Promise.all([
        sb.from("variants").select("sku,image_paths, product:products(images:product_images(path,sort))").or(or),
        sb.from("products").select("sku, images:product_images(path,sort)").or(or),
      ]);
      for (const p of ((ps as any[]) ?? [])) { const img = firstHttp(p.images); if (img) imgByUpper.set(String(p.sku).toUpperCase(), img); }
      for (const v of ((vs as any[]) ?? [])) {
        const vimg = ((v.image_paths as string[]) ?? []).find((u: string) => typeof u === "string" && u.startsWith("http"));
        const img = vimg ?? firstHttp(v.product?.images);
        if (img && !imgByUpper.has(String(v.sku).toUpperCase())) imgByUpper.set(String(v.sku).toUpperCase(), img);
      }
    }
  }

  return rows.map((o) => ({
    id: o.id, invoice_no: o.invoice_no ?? null, customer_name: o.customer_name ?? null, customer_phone: o.customer_phone ?? null,
    total: o.total ?? 0, amount_paid: o.amount_paid ?? 0, payment_ref: o.payment_ref ?? null,
    proofUrl: o.payment_proof_path ?? null, created_at: o.created_at,
    items: ((o.order_items as any[]) ?? []).map((it) => {
      const sku = it.variant?.sku ?? it.product?.sku ?? null;
      const image = imgByUpper.get(String(it.variant?.sku ?? "").toUpperCase()) ?? imgByUpper.get(String(it.product?.sku ?? "").toUpperCase()) ?? null;
      return { name: `${it.product?.name ?? "Item"}${it.variant?.color ? " · " + it.variant.color : ""}`, sku, qty: it.qty ?? 0, image };
    }),
  }));
}
export async function getAbandonedCarts() {
  const sb = supabaseServer();
  // Surface carts gone quiet for 20+ min (a shopper still browsing isn't "abandoned" yet) — OR any cart
  // that REACHED CHECKOUT (finalised), which the owner wants to see immediately so he can close it.
  const idleSince = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  let res = await sb.from("abandoned_carts")
    .select("*").eq("recovered", false).or(`updated_at.lt.${idleSince},reached_checkout.eq.true`)
    .order("updated_at", { ascending: false });
  if (res.error) {
    // `reached_checkout` column may not be deployed yet — fall back to the idle-only rule.
    res = await sb.from("abandoned_carts").select("*").eq("recovered", false).lt("updated_at", idleSince).order("updated_at", { ascending: false });
  }
  const { data } = res;
  // Only surface carts the owner can actually ACT on — a cart with no phone is un-contactable and just
  // clutters the list (owner: "no cart without contact — warna iska koi sense nahi"). This is the final
  // guard; the trackers also avoid saving phone-less carts, but this ensures the admin list is always clean.
  return ((data as any[]) ?? []).filter((c) => String(c?.phone ?? "").replace(/\D/g, "").length >= 7);
}
export async function getSitemapData() {
  const sb = supabaseServer();
  const data = await fetchAll((f, t) => sb.from("products").select("sku, category:categories(slug)").eq("status", "published").range(f, t));
  const { data: cats } = await sb.from("categories").select("slug");
  return { products: ((data as any[]) ?? []).map((p) => ({ sku: p.sku, slug: p.category?.slug ?? "all" })), categories: ((cats as any[]) ?? []).map((c) => c.slug) };
}

// ---------- AI reorder agent ----------
import { classify as _classify, DEFAULT_RULE as _RULE } from "../inventory";
export type ReorderCandidate = { sku: string; name: string; category: string; qty: number; base_wholesale: number; daysSince: number | null; cls: string };
export async function getReorderCandidates(): Promise<ReorderCandidate[]> {
  const sb = supabaseServer();
  const data = await fetchAll((f, t) => sb.from("products").select("sku,name,qty,base_wholesale,last_movement_at,category:categories(name)").range(f, t));
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
  const embRows = await fetchAll((f, t) => sb.from("products").select("sku,embedding").range(f, t));
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
  // Product Photos is where the owner ADDS photos to a piece — so it must include newly created
  // DRAFTS (which don't have photos yet), not just published items. Exclude only archived/deleted.
  // product_status enum = draft | published | flagged (there is NO archived/deleted state — deletion is
  // a hard delete). Filtering with NOT IN (archived,deleted) made Postgres fail casting those unknown
  // labels to the enum, so the whole query errored and the list came back EMPTY. Include every real
  // status (drafts included, so freshly-created pieces show up here to receive their first photo).
  const { data, error } = await sb.from("products")
    .select("id,sku,name,status,category:categories(name,slug), images:product_images(id,path,kind,sort)")
    .in("status", ["draft", "published", "flagged"]).order("sku");
  if (error) console.error("getProductsWithMedia:", error.message);
  const base = ((data as any[]) ?? []).map((p) => ({
    id: p.id, sku: p.sku, name: p.name, status: p.status, category: p.category?.name ?? "—", categorySlug: p.category?.slug ?? "all",
    images: (p.images ?? []).filter((i: any) => typeof i.path === "string" && i.path.startsWith("http")).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0)),
    variants: [] as { sku: string; color: string | null }[],
  }));
  // Attach each product's variant SKUs + colours so Product Photos can be searched by colour.
  const ids = base.map((p) => p.id);
  if (ids.length) {
    const { data: vrows } = await sb.from("variants").select("product_id,sku,color").in("product_id", ids);
    const byP = new Map<string, { sku: string; color: string | null }[]>();
    for (const v of ((vrows as any[]) ?? [])) {
      const a = byP.get(v.product_id) ?? []; a.push({ sku: v.sku, color: v.color ?? null }); byP.set(v.product_id, a);
    }
    for (const p of base) p.variants = byP.get(p.id) ?? [];
  }
  return base;
}
