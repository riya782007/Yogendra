export const dynamic = "force-dynamic";
import Link from "next/link";
import { getCatalogProducts, getCategories } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { CatalogShareBar } from "@/components/site/CatalogShareBar";
import { BUSINESS } from "@/lib/business";

export const metadata = { title: "Catalogue — Blythe Diva" };

export default async function Catalog({ searchParams }: { searchParams: { category?: string } }) {
  const category = searchParams.category ?? "all";
  const [products, categories] = await Promise.all([getCatalogProducts({ category }), getCategories()]);
  const catName = category === "all" ? "Full Collection" : (categories.find((c) => c.slug === category)?.name ?? "Collection");
  const shareText = `${BUSINESS.brand} — ${catName} catalogue`;

  return (
    <main className="min-h-screen bg-ivory">
      {/* Header */}
      <div className="bg-ink text-cream catalog-dark">
        <div className="max-w-6xl mx-auto px-5 py-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] tracking-[0.3em] uppercase text-gold-light">{BUSINESS.legalName} · Sadar Bazar, Delhi</p>
            <h1 className="font-display text-4xl text-ivory mt-1">{BUSINESS.brand}</h1>
            <p className="text-cream/70 text-sm mt-1">{catName} · {products.length} designs · WhatsApp {BUSINESS.phone}</p>
          </div>
          <CatalogShareBar shareText={shareText} />
        </div>
      </div>

      {/* Category chips */}
      <div className="no-print max-w-6xl mx-auto px-5 pt-5 flex flex-wrap gap-2">
        <Link href="/catalog" className={`px-3.5 py-1.5 rounded-full text-sm ${category === "all" ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`}>All</Link>
        {categories.map((c) => (
          <Link key={c.slug} href={`/catalog?category=${c.slug}`} className={`px-3.5 py-1.5 rounded-full text-sm ${category === c.slug ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-gold"}`}>{c.name}</Link>
        ))}
      </div>

      {/* Cards */}
      <div className="max-w-6xl mx-auto px-5 py-6">
        {products.length === 0 ? (
          <p className="text-muted text-center py-16">No designs in this catalogue yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {products.map((p) => (
              <div key={p.sku} className="bg-white rounded-2xl overflow-hidden border border-sand shadow-card break-inside-avoid">
                <div className="aspect-[4/5] bg-cream relative">
                  {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : <ProductImage name={p.name} />}
                  {p.hasOffer && <span className="absolute top-2 left-2 bg-rose text-white text-[10px] px-2 py-0.5 rounded-full">{p.offerPct}% OFF</span>}
                  {p.qty <= 0 && <span className="absolute top-2 right-2 bg-ink/80 text-cream text-[10px] px-2 py-0.5 rounded-full">Out</span>}
                  {p.qty > 0 && p.qty <= 3 && <span className="absolute top-2 right-2 bg-gold text-ink text-[10px] px-2 py-0.5 rounded-full">Only {p.qty}</span>}
                </div>
                <div className="p-3">
                  <p className="text-[10px] uppercase tracking-wide text-gold-dark">{p.category}</p>
                  <p className="text-sm font-medium text-ink leading-tight mt-0.5 line-clamp-2">{p.name}</p>
                  <p className="text-[11px] text-muted font-mono mt-0.5">{p.sku}</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-base font-semibold text-ink">{formatPaise(p.price)}</span>
                    {p.hasOffer && <span className="text-xs text-muted line-through">{formatPaise(p.mrp)}</span>}
                  </div>
                  {p.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {p.tags.map((t: string) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-mist text-emerald-dark">{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-ink text-cream/70 text-center text-sm py-6 mt-6 catalog-dark">
        <p className="text-ivory font-display text-2xl">{BUSINESS.brand}</p>
        <p className="mt-1">Order on WhatsApp: <a href={`https://wa.me/91${BUSINESS.phone.replace(/\D/g, "").slice(-10)}`} className="text-gold-light">{BUSINESS.phone}</a> · {BUSINESS.address}</p>
      </div>
    </main>
  );
}
