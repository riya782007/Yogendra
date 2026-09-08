/**
 * First-paint catalogue reads. The full 4k+ SKU dump times out on Vercel and 500s the
 * shop/trade pages (blank jewellery + "Just a moment"). These queries load ONE page of
 * products plus images/variants for those ids only.
 */
import "server-only";
import { supabaseServer } from "./supabase/server";
import { getPricingFormula, isStorefrontImage } from "./supabase/queries";
import { categoryRef } from "./shopCatalog";
import { GST_RATE } from "./business";
import { resolvePrices, overridesOf } from "./pricing";

const RICH =
  "id,category_id,sku,name,type,base_wholesale,qty,status,created_at,updated_at," +
  "wholesale_only,retail_only,wholesale_override,retail_override,mrp_override,thumbnail_path," +
  "subcategory_id,style_id,more_designs,more_designs_note,default_variant_id," +
  "category:categories(id,name,slug)";
const MIN =
  "id,category_id,sku,name,type,base_wholesale,qty,status,created_at,updated_at," +
  "wholesale_only,retail_only,wholesale_override,retail_override,mrp_override,thumbnail_path," +
  "subcategory_id,style_id,more_designs,more_designs_note";

async function byIds<T>(ids: string[], build: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await build(ids.slice(i, i + 200));
    out.push(...((data as T[]) ?? []));
  }
  return out;
}

async function publishedPage(opts: {
  from: number; to: number; categoryId?: string;
  order: { col: string; asc: boolean };
  retail: boolean;
}): Promise<any[]> {
  const sb = supabaseServer();
  const run = async (cols: string) => {
    let q: any = sb.from("products").select(cols).eq("status", "published");
    if (opts.categoryId) q = q.eq("category_id", opts.categoryId);
    const r = await q.order(opts.order.col, { ascending: opts.order.asc }).range(opts.from, opts.to);
    if (!r.error) return r;
    let q2: any = sb.from("products").select(cols).eq("status", "published");
    if (opts.categoryId) q2 = q2.eq("category_id", opts.categoryId);
    return q2.order("sku").range(opts.from, opts.to);
  };
  let res = await run(RICH);
  if (res.error || res.data == null) res = await run(MIN);
  const rows = ((res?.data as any[]) ?? []).filter((p) => (opts.retail ? !p.wholesale_only : !p.retail_only));
  return rows;
}

async function coversFor(ids: string[]): Promise<Map<string, string>> {
  const sb = supabaseServer();
  const imgBy = new Map<string, string>();
  if (!ids.length) return imgBy;
  const imgs = await byIds(ids, (chunk) => sb.from("product_images").select("product_id,path,sort,kind").in("product_id", chunk));
  const sorted = [...imgs].sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0));
  for (const r of sorted as any[]) {
    if (typeof r.path !== "string" || !r.path.startsWith("http")) continue;
    if (!isStorefrontImage(r.kind)) continue;
    if (!imgBy.has(r.product_id)) imgBy.set(r.product_id, r.path);
  }
  const vimgs = await byIds(ids, (chunk) => sb.from("variants").select("product_id,image_paths,qty").in("product_id", chunk));
  for (const v of vimgs as any[]) {
    if (imgBy.has(v.product_id)) continue;
    const u = ((v.image_paths as string[]) ?? []).find((x) => typeof x === "string" && x.startsWith("http"));
    if (u) imgBy.set(v.product_id, u);
  }
  return imgBy;
}

function asShopCard(p: any, image: string | null) {
  const now = Date.now();
  const isNew = p.created_at ? now - new Date(p.created_at).getTime() < 1000 * 60 * 60 * 24 * 21 : false;
  return {
    ...p,
    category: categoryRef(p),
    image: (typeof p.thumbnail_path === "string" && p.thumbnail_path.startsWith("http") ? p.thumbnail_path : null) || image,
    rating: 4.6,
    reviews: 0,
    isNew,
  };
}

export async function getShopSlice(opts: {
  categorySlug?: string;
  order?: "new" | "sku" | "qty";
  limit?: number;
  offset?: number;
} = {}) {
  const formula = await getPricingFormula();
  const limit = opts.limit ?? 48;
  const offset = opts.offset ?? 0;
  let categoryId: string | undefined;
  if (opts.categorySlug && opts.categorySlug !== "all") {
    const sb = supabaseServer();
    const { data } = await sb.from("categories").select("id,slug").eq("slug", opts.categorySlug).maybeSingle();
    categoryId = (data as any)?.id;
    if (!categoryId) {
      const { data: all } = await sb.from("categories").select("id,slug,name");
      const want = opts.categorySlug.replace(/s$/, "");
      const hit = ((all as any[]) ?? []).find((c) => c.slug === opts.categorySlug || c.slug.replace(/s$/, "") === want || String(c.name || "").toLowerCase().replace(/\s+/g, "-") === opts.categorySlug);
      categoryId = hit?.id;
    }
  }
  const order = opts.order === "sku" ? { col: "sku", asc: true }
    : opts.order === "qty" ? { col: "qty", asc: false }
    : { col: "created_at", asc: false };
  const rows = await publishedPage({ from: offset, to: offset + limit - 1, categoryId, order, retail: true });
  const imgBy = await coversFor(rows.map((p) => p.id));
  const products = rows.map((p) => asShopCard(p, imgBy.get(p.id) ?? null));
  return { products, formula, categoryId: categoryId ?? null };
}

export type TradeRow = {
  pid: string; sku: string; name: string; category: string; sub?: string | null; style?: string | null;
  qty: number; price: number; mrp: number; image: string | null; images?: string[]; colour?: string | null;
  moreDesigns?: boolean; moreDesignsNote?: string | null;
};

export async function getTradeSlice(offset = 0, limit = 48): Promise<{ list: TradeRow[]; hasMore: boolean }> {
  const formula = await getPricingFormula();
  const gstInc = (paise: number) => Math.round(paise * (1 + GST_RATE / 100));
  const rows = await publishedPage({ from: offset, to: offset + limit - 1, order: { col: "updated_at", asc: false }, retail: false });
  const ids = rows.map((p) => p.id);
  const sb = supabaseServer();
  const imgBy = await coversFor(ids);
  const varsBy = new Map<string, any[]>();
  if (ids.length) {
    const vrows = await byIds(ids, (chunk) => sb.from("variants").select("product_id,sku,color,qty,image_paths").gt("qty", 0).in("product_id", chunk));
    for (const v of vrows as any[]) {
      const a = varsBy.get(v.product_id) ?? []; a.push(v); varsBy.set(v.product_id, a);
    }
  }
  const subIds = [...new Set(rows.map((p) => p.subcategory_id).filter(Boolean))];
  const styleIds = [...new Set(rows.map((p) => p.style_id).filter(Boolean))];
  const subName = new Map<string, string>();
  const styleName = new Map<string, string>();
  if (subIds.length) {
    const { data } = await sb.from("subcategories").select("id,name").in("id", subIds);
    for (const s of ((data as any[]) ?? [])) subName.set(s.id, s.name);
  }
  if (styleIds.length) {
    const { data } = await sb.from("styles").select("id,name").in("id", styleIds);
    for (const s of ((data as any[]) ?? [])) styleName.set(s.id, s.name);
  }
  const list: TradeRow[] = [];
  for (const p of rows) {
    const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
    const price = gstInc(ps.wholesaleRate);
    const tp = p.thumbnail_path;
    const parentImg = (typeof tp === "string" && tp.startsWith("http")) ? tp : (imgBy.get(p.id) ?? null);
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
  return { list, hasMore: rows.length >= limit };
}
