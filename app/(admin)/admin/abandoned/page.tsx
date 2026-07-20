export const dynamic = "force-dynamic";
import { getAbandonedCarts } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { AbandonedCartCard } from "@/components/admin/AbandonedCartCard";
import { ClearAnonCartsButton } from "@/components/admin/ClearAnonCartsButton";

export const metadata = { title: "Owner Console · Abandoned Carts" };

export default async function Abandoned() {
  const carts = await getAbandonedCarts();
  const recoverable = carts.reduce((s: number, c: any) => s + (c.total ?? 0), 0);

  // #21: first image + category slug per SKU — powers the thumbnails and the "View product" links.
  const allSkus = Array.from(new Set(
    carts.flatMap((c: any) => ((c.items ?? []) as any[]).map((i) => i.sku).filter(Boolean)),
  ));
  const imgMap: Record<string, string> = {};
  const slugMap: Record<string, string> = {};
  if (allSkus.length) {
    const sbA = supabaseServer();
    // Cart items can be PRODUCT skus OR VARIANT skus (e.g. JBKN5775-RUBY). Resolve both, and match
    // case-insensitively (carts may store GOLD / Gold / gold). Keyed by upper(sku).
    const imgByUpper = new Map<string, string>();
    const slugByUpper = new Map<string, string>();
    const firstHttp = (arr: any[]) => (arr ?? []).filter((i) => typeof i?.path === "string" && i.path.startsWith("http")).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.path as string | undefined;
    const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
    // Products (match by SKU, case-insensitive).
    for (const grp of chunk(allSkus, 60)) {
      const { data } = await sbA.from("products").select("sku, category:categories(slug), images:product_images(path,sort)").or(grp.map((s) => `sku.ilike.${String(s).replace(/[,()]/g, "")}`).join(","));
      for (const p of (data as any[]) ?? []) {
        const img = firstHttp(p.images); const k = String(p.sku).toUpperCase();
        if (img) imgByUpper.set(k, img);
        if (p.category?.slug) slugByUpper.set(k, p.category.slug);
      }
    }
    // Variants → the colour's own photo, else the parent product's photo.
    for (const grp of chunk(allSkus, 60)) {
      const { data } = await sbA.from("variants").select("sku, image_paths, product:products(category:categories(slug), images:product_images(path,sort))").or(grp.map((s) => `sku.ilike.${String(s).replace(/[,()]/g, "")}`).join(","));
      for (const v of (data as any[]) ?? []) {
        const k = String(v.sku).toUpperCase();
        const vimg = ((v.image_paths as string[]) ?? []).find((u) => typeof u === "string" && u.startsWith("http"));
        const img = vimg ?? firstHttp(v.product?.images);
        if (img && !imgByUpper.has(k)) imgByUpper.set(k, img);
        if (v.product?.category?.slug && !slugByUpper.has(k)) slugByUpper.set(k, v.product.category.slug);
      }
    }
    for (const s of allSkus) {
      const u = String(s).toUpperCase();
      if (imgByUpper.has(u)) imgMap[s] = imgByUpper.get(u)!;
      if (slugByUpper.has(u)) slugMap[s] = slugByUpper.get(u)!;
    }
  }
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Abandoned Carts</h1>
      <p className="text-sm text-muted mb-3">Shoppers who added to bag but didn&apos;t buy. <span className="text-emerald font-medium">{formatPaise(recoverable)}</span> recoverable — nudge them on WhatsApp. Tap a cart to see full product &amp; customer detail. Use <b>✕</b> on any card to remove an irrelevant one.</p>
      <div className="mb-5"><ClearAnonCartsButton /></div>

      <div className="space-y-3">
        {carts.length === 0 && <p className="text-sm text-muted">No abandoned carts.</p>}
        {carts.map((c: any) => (
          <AbandonedCartCard key={c.id} cart={c} imgMap={imgMap} slugMap={slugMap} />
        ))}
      </div>
    </main>
  );
}
