"use client";
/**
 * SelectableCatalog — the shareable catalogue grid (Phase 5).
 *
 * Renders rich cards (image, category › subcategory, name, SKU, prices, stock, tags)
 * and a "select pieces to share" mode that builds a /catalog?skus=… link for just the
 * chosen products — so the owner can send "only these 6 designs" on WhatsApp without
 * exposing the whole inventory. View toggle (retail / wholesale) controls which price
 * is shown, for sharing with shoppers vs wholesale buyers.
 */
import { useMemo, useState } from "react";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";

export type CatalogItem = {
  sku: string; name: string;
  category: string; categorySlug: string;
  subcategory: string | null; subcategorySlug: string | null;
  qty: number; wholesale: number; price: number; mrp: number; offerPct: number; hasOffer: boolean;
  image: string | null; tags: string[]; keywords: string[];
};

export function SelectableCatalog({ products, view, brand, phone }: { products: CatalogItem[]; view: "retail" | "wholesale"; brand: string; phone: string }) {
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (sku: string) =>
    setSel((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || sel.size === 0) return "";
    const u = new URL("/catalog", window.location.origin);
    u.searchParams.set("skus", [...sel].join(","));
    if (view === "wholesale") u.searchParams.set("view", "wholesale");
    return u.toString();
  }, [sel, view]);

  const copy = () => { if (shareUrl) navigator.clipboard?.writeText(shareUrl).catch(() => {}); };
  const whatsapp = () => { if (shareUrl) window.open(`https://wa.me/?text=${encodeURIComponent(`${brand} — ${sel.size} pieces\n${shareUrl}`)}`, "_blank"); };

  return (
    <div>
      {/* Toolbar */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        <button onClick={() => { setPicking((p) => !p); setSel(new Set()); }}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${picking ? "bg-ink text-white" : "bg-white border border-sand text-ink hover:border-gold"}`}>
          {picking ? "✓ Selecting — tap pieces" : "✷ Select pieces to share"}
        </button>
        {picking && (
          <>
            <span className="text-sm text-muted">{sel.size} selected</span>
            <button disabled={sel.size === 0} onClick={copy} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-40">🔗 Copy link</button>
            <button disabled={sel.size === 0} onClick={whatsapp} className="px-4 py-2 rounded-full bg-emerald text-white text-sm hover:bg-emerald-dark disabled:opacity-40">Share {sel.size > 0 ? `${sel.size} ` : ""}on WhatsApp</button>
          </>
        )}
      </div>

      {products.length === 0 ? (
        <p className="text-muted text-center py-16">No designs in this catalogue yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => {
            const on = sel.has(p.sku);
            const showPrice = view === "wholesale" ? p.wholesale : p.price;
            const chips = [...new Set([...(p.tags ?? []), ...(p.keywords ?? [])])].slice(0, 4);
            return (
              <div key={p.sku}
                onClick={picking ? () => toggle(p.sku) : undefined}
                className={`bg-white rounded-2xl overflow-hidden border shadow-card break-inside-avoid transition-all ${picking ? "cursor-pointer" : ""} ${on ? "border-emerald ring-2 ring-emerald/40" : "border-sand"}`}>
                <div className="aspect-[4/5] bg-cream relative">
                  <ProductImage src={p.image} name={p.name} />
                  {picking && (
                    <span className={`absolute top-2 left-2 h-6 w-6 rounded-full grid place-items-center text-xs ${on ? "bg-emerald text-white" : "bg-white/80 text-ink border border-sand"}`}>{on ? "✓" : ""}</span>
                  )}
                  {!picking && p.hasOffer && view === "retail" && <span className="absolute top-2 left-2 bg-rose text-white text-[10px] px-2 py-0.5 rounded-full">{p.offerPct}% OFF</span>}
                  {p.qty <= 0 && <span className="absolute top-2 right-2 bg-ink/80 text-cream text-[10px] px-2 py-0.5 rounded-full">Out</span>}
                  {p.qty > 0 && p.qty <= 3 && <span className="absolute top-2 right-2 bg-gold text-ink text-[10px] px-2 py-0.5 rounded-full">Only {p.qty}</span>}
                </div>
                <div className="p-3">
                  <p className="text-[10px] uppercase tracking-wide text-gold-dark">{p.category}{p.subcategory ? ` › ${p.subcategory}` : ""}</p>
                  <p className="text-sm font-medium text-ink leading-tight mt-0.5 line-clamp-2">{p.name}</p>
                  <p className="text-[11px] text-muted font-mono mt-0.5">{p.sku}</p>
                  <div className="flex items-baseline gap-1.5 mt-1">
                    <span className="text-base font-semibold text-ink">{formatPaise(showPrice)}</span>
                    {view === "wholesale" ? (
                      <span className="text-[10px] uppercase tracking-wide text-emerald-dark">wholesale</span>
                    ) : p.hasOffer ? (
                      <span className="text-xs text-muted line-through">{formatPaise(p.mrp)}</span>
                    ) : null}
                  </div>
                  {chips.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {chips.map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-mist text-emerald-dark">{t}</span>)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
