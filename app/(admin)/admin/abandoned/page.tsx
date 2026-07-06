export const dynamic = "force-dynamic";
import { getAbandonedCarts } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { AbandonedCartCard } from "@/components/admin/AbandonedCartCard";

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
    const { data } = await supabaseServer().from("products").select("sku, category:categories(slug), images:product_images(path,sort)").in("sku", allSkus);
    for (const p of (data as any[]) ?? []) {
      const imgs = ((p.images as any[]) ?? []).filter((i) => typeof i.path === "string" && i.path.startsWith("http")).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      if (imgs[0]) imgMap[p.sku] = imgs[0].path;
      if (p.category?.slug) slugMap[p.sku] = p.category.slug;
    }
  }
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Abandoned Carts</h1>
      <p className="text-sm text-muted mb-6">Shoppers who added to bag but didn&apos;t buy. <span className="text-emerald font-medium">{formatPaise(recoverable)}</span> recoverable — nudge them on WhatsApp. Tap a cart to see full product &amp; customer detail.</p>

      <div className="space-y-3">
        {carts.length === 0 && <p className="text-sm text-muted">No abandoned carts.</p>}
        {carts.map((c: any) => (
          <AbandonedCartCard key={c.id} cart={c} imgMap={imgMap} slugMap={slugMap} />
        ))}
      </div>
    </main>
  );
}
