export const dynamic = "force-dynamic";
import { getAbandonedCarts } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";

export const metadata = { title: "Owner Console · Abandoned Carts" };
const ago = (d: string) => { const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000); return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`; };

export default async function Abandoned() {
  const carts = await getAbandonedCarts();
  const recoverable = carts.reduce((s: number, c: any) => s + (c.total ?? 0), 0);

  // #21: show each abandoned cart as a mini-catalog — pull the first image per SKU.
  const allSkus = Array.from(new Set(
    carts.flatMap((c: any) => ((c.items ?? []) as any[]).map((i) => i.sku).filter(Boolean)),
  ));
  const imgMap: Record<string, string> = {};
  if (allSkus.length) {
    const { data } = await supabaseServer().from("products").select("sku, images:product_images(path,sort)").in("sku", allSkus);
    for (const p of (data as any[]) ?? []) {
      const imgs = ((p.images as any[]) ?? []).filter((i) => typeof i.path === "string" && i.path.startsWith("http")).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      if (imgs[0]) imgMap[p.sku] = imgs[0].path;
    }
  }
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Abandoned Carts</h1>
      <p className="text-sm text-muted mb-6">Shoppers who added to bag but didn&apos;t buy. <span className="text-emerald font-medium">{formatPaise(recoverable)}</span> recoverable — nudge them on WhatsApp.</p>

      <div className="space-y-3">
        {carts.length === 0 && <p className="text-sm text-muted">No abandoned carts.</p>}
        {carts.map((c: any) => {
          const items = (c.items ?? []) as { sku?: string; name: string; qty: number; price: number }[];
          const wa = c.phone ? `https://wa.me/${String(c.phone).replace(/\D/g, "")}?text=${encodeURIComponent(`Hi ${c.customer_name || "there"}! You left some beautiful pieces in your Blythe Diva bag. Complete your order and enjoy 20% off ✨`)}` : null;
          return (
            <div key={c.id} className="bg-white rounded-2xl p-5 shadow-card">
              <div className="flex items-start justify-between gap-4 mb-3">
                <p className="font-medium text-ink">{c.customer_name || "Anonymous visitor"} <span className="text-xs text-muted">· {ago(c.created_at)} · {items.length} item{items.length === 1 ? "" : "s"}</span></p>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-ink">{formatPaise(c.total)}</p>
                  {wa ? <a href={wa} target="_blank" rel="noreferrer" className="text-xs text-emerald nav-link">WhatsApp nudge →</a> : <span className="text-xs text-muted">no contact</span>}
                </div>
              </div>
              {/* mini-catalog of the abandoned items */}
              <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2">
                {items.map((it, idx) => (
                  <div key={idx} className="rounded-xl border border-sand overflow-hidden bg-cream/40">
                    <div className="aspect-square bg-cream">
                      {it.sku && imgMap[it.sku] ? <img src={imgMap[it.sku]} alt={it.name} className="w-full h-full object-cover" /> : <ProductImage name={it.name} />}
                    </div>
                    <div className="p-1.5">
                      {it.sku && <p className="text-[10px] font-mono text-muted truncate">{it.sku}</p>}
                      <p className="text-[11px] text-ink leading-tight line-clamp-2">{it.name}</p>
                      <p className="text-[11px] text-muted mt-0.5">×{it.qty} · {formatPaise(it.price)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
