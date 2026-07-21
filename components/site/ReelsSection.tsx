import Link from "next/link";
import { ProductImage } from "@/components/Placeholder";
import { formatPaise } from "@/lib/pricing";
import { ReelPlayer } from "@/components/site/ReelPlayer";
import type { ShopReel } from "@/lib/supabase/queries";

export function ReelsSection({ reels }: { reels: ShopReel[] }) {
  if (!reels.length) return null;
  return (
    <section className="max-w-7xl mx-auto px-5 py-12">
      <div className="text-center mb-8">
        <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Watch · Tap · Buy</p>
        <h2 className="font-display text-4xl text-ink mt-1">Shop the Reels</h2>
      </div>
      <div className="flex gap-5 overflow-x-auto pb-3 snap-x">
        {reels.map((r) => (
          <div key={r.id} className="snap-start shrink-0 w-72">
            <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-ink">
              <ReelPlayer videoUrl={r.video_url} caption={r.caption} />
            </div>
            {r.products.length > 0 && (
              <>
                <p className="text-[11px] uppercase tracking-wide text-muted mt-2 mb-1">Shop this look</p>
                <div className="flex gap-2 overflow-x-auto">
                  {r.products.slice(0, 4).map((p) => (
                    <Link key={p.sku} href={`/shop/${p.categorySlug}/${p.sku}`} className="shrink-0 w-20 group">
                      <div className="aspect-square rounded-lg overflow-hidden bg-cream"><ProductImage name={p.name} /></div>
                      <p className="text-[11px] font-medium text-ink mt-1">{formatPaise(p.price)}</p>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
