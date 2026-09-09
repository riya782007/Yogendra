/**
 * Catalogue reads for shop + trade. First paint loads ONE page of products plus
 * images/variants for those ids only — dumping the full 4k+ SKU set times out on
 * Vercel and leaves trade.blythediva.com on a blank/black screen.
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseReadClients, supabaseServer } from "./supabase/server";
import { categoryRef } from "./shopCatalog";
import { GST_RATE } from "./business";
import { resolvePrices, overridesOf, DEFAULT_FORMULA, cleanTiers } from "./pricing";

const STOREFRONT_HIDDEN_IMAGE_KINDS = new Set(["source", "flatlay"]);
function isStorefrontImage(kind?: string | null): boolean {
  return !STOREFRONT_HIDDEN_IMAGE_KINDS.has((kind ?? "").toLowerCase());
}

const COLS = [
  "id,category_id,sku,name,type,base_wholesale,qty,status,created_at,wholesale_only,retail_only,wholesale_override,retail_override,mrp_override,thumbnail_path,subcategory_id,style_id,more_designs,more_designs_note,default_variant_id,category:categories(id,name,slug)",
  "id,category_id,sku,name,type,base_wholesale,qty,status,created_at,wholesale_only,retail_only,thumbnail_path,category:categories(id,name,slug)",
  "id,category_id,sku,name,base_wholesale,qty,status,created_at,wholesale_only,retail_only,thumbnail_path",
  "id,sku,name,qty,status,base_wholesale,thumbnail_path,category_id",
  "id,sku,name,qty,status,base_wholesale",
];

async function byIds<T>(ids: string[], build: (sb: ReturnType<typeof supabaseServer>, chunk: string[]) => PromiseLike<{ data: T[] | null; error?: unknown }>): Promise<T[]> {
  if (!ids.length) return [];
  const out: T[] = [];
  for (const sb of supabaseReadClients()) {
    const batch: T[] = [];
    let failed = false;
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await build(sb, ids.slice(i, i + 200));
      if (error) { failed = true; break; }
      batch.push(...((data as T[]) ?? []));
    }
    if (!failed) { out.push(...batch); if (out.length) return out; }
  }
  return out;
}

const PAGE = 1000;

function keepRow(p: any, retail: boolean) {
  // Public catalogues must never expose non-published rows when a query fallback is used.
  if (p.status !== "published") return false;
  return retail ? !p.wholesale_only : !p.retail_only;
}

async function runRange(
  sb: ReturnType<typeof supabaseServer>,
  cols: string,
  opts: { categoryId?: string; order: { col: string; asc: boolean }; publishedOnly: boolean; from: number; to: number },
) {
  let q: any = sb.from("products").select(cols);
  if (opts.publishedOnly) q = q.eq("status", "published");
  if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
  return q.order(opts.order.col, { ascending: opts.order.asc }).range(opts.from, opts.to);
}

/** Every published design (paged past PostgREST's 1000-row cap). Keeps partial pages. */
async function publishedAll(opts: {
  categoryId?: string;
  order: { col: string; asc: boolean };
  retail: boolean;
}): Promise<any[]> {
  const orderTries = [opts.order, { col: "sku", asc: true }];
  for (const sb of supabaseReadClients()) {
    for (const cols of COLS) {
      for (const ord of orderTries) {
        for (const publishedOnly of [true]) {
          try {
            const first = await runRange(sb, cols, { ...opts, order: ord, publishedOnly, from: 0, to: PAGE - 1 });
            if (first.error || !Array.isArray(first.data)) continue;
            const out = (first.data as any[]).filter((p) => keepRow(p, opts.retail));
            let rawLen = (first.data as any[]).length;
            for (let from = PAGE; rawLen >= PAGE; from += PAGE) {
              const r = await runRange(sb, cols, { ...opts, order: ord, publishedOnly, from, to: from + PAGE - 1 });
              if (r.error || !Array.isArray(r.data)) break;
              const chunk = r.data as any[];
              out.push(...chunk.filter((p) => keepRow(p, opts.retail)));
              rawLen = chunk.length;
            }
            if (out.length) return out;
          } catch { /* next fallback */ }
        }
      }
    }
  }
  return [];
}

async function publishedPage(opts: {
  from: number; to: number; categoryId?: string;
  order: { col: string; asc: boolean };
  retail: boolean;
}): Promise<any[]> {
  const orderTries = [opts.order, { col: "sku", asc: true }];
  for (const sb of supabaseReadClients()) {
    for (const cols of COLS) {
      for (const ord of orderTries) {
        for (const publishedOnly of [true]) {
          try {
            const r = await runRange(sb, cols, { ...opts, order: ord, publishedOnly, from: opts.from, to: opts.to });
            const raw = !r.error && Array.isArray(r.data) ? (r.data as any[]) : [];
            const rows = raw.filter((p) => keepRow(p, opts.retail));
            if (rows.length) return rows;
          } catch { /* next fallback */ }
        }
      }
    }
  }
  return [];
}

async function coversFor(ids: string[]): Promise<Map<string, string>> {
  const imgBy = new Map<string, string>();
  if (!ids.length) return imgBy;
  try {
    const imgs = await byIds(ids, (sb, chunk) => sb.from("product_images").select("product_id,path,sort,kind").in("product_id", chunk));
    const sorted = [...imgs].sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));
    for (const r of sorted as any[]) {
      if (typeof r.path !== "string" || !r.path.startsWith("http")) continue;
      if (!isStorefrontImage(r.kind)) continue;
      if (!imgBy.has(r.product_id)) imgBy.set(r.product_id, r.path);
    }
    const vimgs = await byIds(ids, (sb, chunk) => sb.from("variants").select("product_id,image_paths,qty").in("product_id", chunk));
    for (const v of vimgs as any[]) {
      if (imgBy.has(v.product_id) || (v.qty ?? 0) <= 0) continue;
      const u = ((v.image_paths as string[]) ?? []).find((x) => typeof x === "string" && x.startsWith("http"));
      if (u) imgBy.set(v.product_id, u);
    }
  } catch { /* cards still render without photos */ }
  return imgBy;
}

function asShopCard(p: any, image: string | null) {
  const now = Date.now();
  const isNew = p.created_at ? now - new Date(p.created_at).getTime() < 1000 * 60 * 60 * 24 * 21 : false;
  return {
    ...p,
    category: categoryRef(p),
    // `image` comes from current image rows, so a deleted pinned thumbnail cannot render.
    image,
    rating: 4.6,
    reviews: 0,
    isNew,
  };
}

async function formulaOf() {
  try {
    const { data } = await supabaseServer().from("pricing_settings").select("*").limit(1).maybeSingle();
    return {
      wholesaleMarkupPct: Number(data?.wholesale_markup_pct ?? 10),
      retailMultiplier: Number(data?.retail_multiplier ?? 2.2),
      mrpMultiplier: Number(data?.mrp_multiplier ?? 2.75),
      roundToPaise: Number(data?.round_to ?? 100),
      useBuildup: Boolean(data?.use_buildup ?? false),
      shippingPct: Number(data?.shipping_pct ?? 10),
      packingPct: Number(data?.packing_pct ?? 11.36),
      promotionPct: Number(data?.promotion_pct ?? 10.2),
      packingFlat: Number(data?.packing_flat ?? 2500),
      promotionFlat: Number(data?.promotion_flat ?? 2500),
      resellerPct: Number(data?.reseller_pct ?? 15),
      customerDiscountPct: Number(data?.customer_discount_pct ?? 5),
      mrpPct: Number(data?.mrp_pct ?? 25),
      wholesaleMinOrder: Number(data?.wholesale_min_order ?? 300000),
      wholesaleTiers: cleanTiers(data?.wholesale_tiers),
    };
  } catch {
    return { ...DEFAULT_FORMULA };
  }
}

export async function getShopSlice(opts: {
  categorySlug?: string;
  order?: "new" | "sku" | "qty";
  /** Omit to return the entire published retail catalogue. */
  limit?: number;
  offset?: number;
} = {}) {
  const formula = await formulaOf();
  const offset = opts.offset ?? 0;
  let categoryId: string | undefined;
  if (opts.categorySlug && opts.categorySlug !== "all") {
    for (const sb of supabaseReadClients()) {
      const { data } = await sb.from("categories").select("id,slug,name").eq("slug", opts.categorySlug).maybeSingle();
      categoryId = (data as any)?.id;
      if (categoryId) break;
      const { data: all } = await sb.from("categories").select("id,slug,name");
      const want = opts.categorySlug.replace(/s$/, "");
      const hit = ((all as any[]) ?? []).find((c) => c.slug === opts.categorySlug || c.slug.replace(/s$/, "") === want || String(c.name || "").toLowerCase().replace(/\s+/g, "-") === opts.categorySlug);
      categoryId = hit?.id;
      if (categoryId) break;
    }
  }
  const order = opts.order === "sku" ? { col: "sku", asc: true }
    : opts.order === "qty" ? { col: "qty", asc: false }
    : { col: "created_at", asc: false };
  let rows = await publishedAll({ categoryId, order, retail: true });
  if (opts.limit != null) rows = rows.slice(offset, offset + opts.limit);
  const ids = rows.map((p) => p.id);
  const variants = await byIds(ids, (sb, chunk) => sb.from("variants").select("product_id,qty").in("product_id", chunk));
  const variantQty = new Map<string, number>();
  const hasVariants = new Set<string>();
  for (const variant of variants as any[]) {
    hasVariants.add(variant.product_id);
    variantQty.set(variant.product_id, (variantQty.get(variant.product_id) ?? 0) + (variant.qty ?? 0));
  }
  // Variant quantities are authoritative when variants exist; otherwise use product quantity.
  rows = rows.filter((p) => (hasVariants.has(p.id) ? (variantQty.get(p.id) ?? 0) : (p.qty ?? 0)) > 0);
  const imgBy = await coversFor(rows.map((p) => p.id));
  const products = rows.map((p) => asShopCard(p, imgBy.get(p.id) ?? null));
  return { products, formula, categoryId: categoryId ?? null };
}

/** One cover photo per category tile so Shop by Category is not letter placeholders. */
export async function getCategoryCovers(cats: { id: string; slug: string }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const real = cats.filter((c) => c.id && !String(c.id).startsWith("fallback"));
  if (!real.length) return out;
  await Promise.all(real.map(async (c) => {
    for (const sb of supabaseReadClients()) {
      const { data, error } = await sb.from("products")
        .select("id")
        .eq("status", "published")
        .gt("qty", 0)
        .eq("category_id", c.id)
        .limit(4);
      if (error || !data?.length) continue;
      const rows = data as any[];
      // Resolve from current image rows rather than a pinned URL, which may reference a deleted image.
      const imgBy = await coversFor(rows.map((p) => p.id));
      const u = rows.map((p) => imgBy.get(p.id)).find(Boolean);
      if (u) { out.set(c.slug, u); return; }
    }
  }));
  return out;
}

async function lookupNames(table: "subcategories" | "styles", ids: string[]): Promise<[string, string][]> {
  if (!ids.length) return [];
  for (const sb of supabaseReadClients()) {
    const { data } = await sb.from(table).select("id,name").in("id", ids);
    const rows = (data as any[]) ?? [];
    if (rows.length) return rows.map((s) => [s.id as string, s.name as string]);
  }
  return [];
}

export type TradeRow = {
  pid: string; sku: string; name: string; category: string; sub?: string | null; style?: string | null;
  qty: number; price: number; mrp: number; image: string | null; images?: string[]; colour?: string | null;
  moreDesigns?: boolean; moreDesignsNote?: string | null;
};

/** Designs fetched on the wholesale portal's first paint (and each "Load more"). */
export const TRADE_PAGE_SIZE = 48;

export async function getTradeSlice(offset = 0, limit: number = TRADE_PAGE_SIZE): Promise<{ list: TradeRow[]; hasMore: boolean }> {
  const formula = await formulaOf();
  const gstInc = (paise: number) => Math.round(paise * (1 + GST_RATE / 100));
  const order = { col: "created_at", asc: false };
  const rows = (limit != null && limit > 0)
    ? await publishedPage({ from: offset, to: offset + limit - 1, order, retail: false })
    : await publishedAll({ order, retail: false });
  const ids = rows.map((p) => p.id);
  const subIds = [...new Set(rows.map((p) => p.subcategory_id).filter(Boolean))];
  const styleIds = [...new Set(rows.map((p) => p.style_id).filter(Boolean))];
  const [imgBy, vrows, subPairs, stylePairs] = await Promise.all([
    coversFor(ids),
    ids.length
      ? byIds(ids, (sb, chunk) => sb.from("variants").select("product_id,sku,color,qty,image_paths").gt("qty", 0).in("product_id", chunk))
      : Promise.resolve([] as any[]),
    lookupNames("subcategories", subIds),
    lookupNames("styles", styleIds),
  ]);
  const varsBy = new Map<string, any[]>();
  for (const v of vrows as any[]) {
    const a = varsBy.get(v.product_id) ?? []; a.push(v); varsBy.set(v.product_id, a);
  }
  const subName = new Map(subPairs);
  const styleName = new Map(stylePairs);
  const list: TradeRow[] = [];
  for (const p of rows) {
    const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
    const price = gstInc(ps.wholesaleRate);
    const parentImg = imgBy.get(p.id) ?? null;
    const catName = categoryRef(p).name;
    const allVs = varsBy.get(p.id) ?? [];
    const sub = p.subcategory_id ? subName.get(p.subcategory_id) ?? null : null;
    const style = p.style_id ? styleName.get(p.style_id) ?? null : null;
    if (allVs.length > 0) {
      for (const v of allVs) {
        const vImgs = Array.isArray(v.image_paths) ? v.image_paths.filter((x: string) => typeof x === "string" && x.startsWith("http")) : [];
        const images = (vImgs.length ? vImgs : (parentImg ? [parentImg] : [])).slice(0, 3);
        list.push({
          pid: p.id, sku: v.sku, name: p.name, category: catName, sub, style, colour: v.color ?? null,
          qty: v.qty ?? 0, price, mrp: ps.mrp, image: images[0] ?? parentImg, images,
          moreDesigns: !!p.more_designs, moreDesignsNote: p.more_designs_note ?? null,
        });
      }
    } else {
      if ((p.qty ?? 0) <= 0) continue;
      list.push({
        pid: p.id, sku: p.sku, name: p.name, category: catName, sub, style, colour: null,
        qty: p.qty, price, mrp: ps.mrp, image: parentImg, images: parentImg ? [parentImg] : [],
        moreDesigns: !!p.more_designs, moreDesignsNote: p.more_designs_note ?? null,
      });
    }
  }
  return { list, hasMore: limit != null && limit > 0 && rows.length >= limit };
}

/** Cached first-paint / load-more windows. Empty first pages are not stored (avoids a blank portal). */
export async function getTradeSliceCached(offset = 0, limit: number = TRADE_PAGE_SIZE) {
  try {
    return await unstable_cache(
      async () => {
        const slice = await getTradeSlice(offset, limit);
        if (offset === 0 && slice.list.length === 0) throw new Error("trade slice empty — not caching");
        return slice;
      },
      ["trade-slice-v1", String(offset), String(limit)],
      { tags: ["storefront"], revalidate: 120 },
    )();
  } catch {
    return getTradeSlice(offset, limit);
  }
}
