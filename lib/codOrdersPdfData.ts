import { supabaseServer } from "@/lib/supabase/server";
import type { PdfCodOrder } from "@/lib/codOrdersPdf";

const httpFirst = (arr?: any[]): string | undefined =>
  (Array.isArray(arr) ? arr.find((u: any) => typeof u === "string" && u.startsWith("http")) : undefined);
const isHttp = (s: any): s is string => typeof s === "string" && s.startsWith("http");

async function inChunks<T>(ids: string[], size: number, fn: (part: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) out.push(...await fn(ids.slice(i, i + size)));
  return out;
}

/**
 * COD PDF payload (photos + lines). Called ON CLICK, not on every COD page render —
 * prefetching every variant's image_paths for 300 bills is what helped time out admin-bd.
 */
export async function loadCodPdfPayload(orderIds: string[]): Promise<{ orders: PdfCodOrder[]; imgMap: Record<string, string> }> {
  const ids = [...new Set(orderIds.map((s) => String(s ?? "").trim()).filter(Boolean))].slice(0, 300);
  if (!ids.length) return { orders: [], imgMap: {} };
  const sb = supabaseServer();

  const ordersRaw = await inChunks(ids, 80, async (part) => {
    const { data } = await sb.from("orders")
      .select("id,invoice_no,channel,customer_name,customer_phone,buyer_address,total,created_at")
      .in("id", part);
    return ((data as any[]) ?? []);
  });
  const byId = new Map(ordersRaw.map((o) => [o.id, o]));

  const lines = await inChunks(ids, 40, async (part) => {
    const { data } = await sb.from("order_items")
      .select("order_id,qty,unit_price, product:products(id,name,sku,thumbnail_path), variant:variants(sku,color,image_paths,product_id)")
      .in("order_id", part);
    return ((data as any[]) ?? []);
  });
  const itemsByOrder = new Map<string, any[]>();
  for (const it of lines) {
    const a = itemsByOrder.get(it.order_id) ?? [];
    a.push(it);
    itemsByOrder.set(it.order_id, a);
  }

  const imgMap: Record<string, string> = {};
  const missingProductIds = new Set<string>();
  for (const it of lines) {
    const sku = String(it.variant?.sku ?? it.product?.sku ?? "").trim();
    const img = httpFirst(it.variant?.image_paths)
      ?? (isHttp(it.product?.thumbnail_path) ? it.product.thumbnail_path : undefined);
    if (sku && img) imgMap[sku] = img;
    else if (it.product?.id) missingProductIds.add(it.product.id);
  }
  if (missingProductIds.size) {
    const sibs = await inChunks([...missingProductIds], 40, async (part) => {
      const { data } = await sb.from("variants").select("product_id,image_paths").in("product_id", part);
      return ((data as any[]) ?? []);
    });
    const siblingByProduct = new Map<string, string>();
    for (const v of sibs) {
      const img = httpFirst(v.image_paths as any[]);
      if (img && !siblingByProduct.has(v.product_id)) siblingByProduct.set(v.product_id, img);
    }
    for (const it of lines) {
      const sku = String(it.variant?.sku ?? it.product?.sku ?? "").trim();
      if (!sku || imgMap[sku] || !it.product?.id) continue;
      const img = siblingByProduct.get(it.product.id);
      if (img) imgMap[sku] = img;
    }
  }

  const orders: PdfCodOrder[] = ids.map((id) => {
    const r = byId.get(id);
    const its = itemsByOrder.get(id) ?? [];
    return {
      id,
      invoice_no: r?.invoice_no,
      channel: r?.channel,
      customer_name: r?.customer_name,
      customer_phone: r?.customer_phone,
      buyer_address: r?.buyer_address,
      total: r?.total,
      created_at: r?.created_at,
      items: its.map((it: any) => ({
        sku: it.variant?.sku ?? it.product?.sku ?? "",
        name: it.product?.name ?? "",
        qty: it.qty ?? 1,
        price: it.unit_price ?? 0,
        color: it.variant?.color ?? "",
      })),
    };
  });
  return { orders, imgMap };
}
