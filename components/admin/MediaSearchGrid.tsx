"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { MediaCard } from "@/components/admin/MediaCard";

type Variant = { sku: string; color: string | null };
type Prod = { id: string; sku: string; name: string; category: string; categorySlug: string; images: any[]; variants: Variant[] };

/**
 * MediaSearchGrid — Product Photos list with a search box. Filters by product name, SKU, or a
 * variant's colour / variant SKU, so the owner can jump straight to the piece (and its colour)
 * he wants to work on. Matching variant colours are surfaced as chips on the card.
 */
export function MediaSearchGrid({ products, ready }: { products: Prod[]; ready: boolean }) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return products.map((p) => ({ p, hits: [] as string[] }));
    return products
      .map((p) => {
        const nameHit = p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s);
        const hits = p.variants.filter((v) => (v.color ?? "").toLowerCase().includes(s) || (v.sku ?? "").toLowerCase().includes(s));
        return { p, hits: hits.map((v) => v.color ?? v.sku).filter(Boolean) as string[], match: nameHit || hits.length > 0 };
      })
      .filter((x) => x.match)
      .map(({ p, hits }) => ({ p, hits }));
  }, [q, products]);

  return (
    <div>
      <div className="relative mb-4">
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 Search by product, SKU, or colour (e.g. CCEE5723, Black, necklace)…"
          className="w-full rounded-xl border border-sand bg-white px-4 py-2.5 text-sm outline-none focus:border-emerald"
        />
        {q && <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink text-sm">✕</button>}
      </div>
      {q && <p className="text-xs text-muted mb-3">{filtered.length} match{filtered.length === 1 ? "" : "es"} for “{q}”.</p>}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted py-10 text-center">No products match “{q}”. Try a SKU or a colour name.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {filtered.map(({ p, hits }) => (
            <div key={p.id} className="relative">
              <Link href={`/admin/media/${p.id}`} className="absolute right-3 top-3 z-10 px-2.5 py-1 rounded-full bg-ink text-white text-xs hover:bg-ink/90">✦ AI Studio</Link>
              <MediaCard p={p as any} geminiReady={ready} />
              {hits.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5 px-1">
                  <span className="text-[10px] text-muted">Matched colours:</span>
                  {[...new Set(hits)].slice(0, 8).map((c) => (
                    <span key={c} className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-mist text-emerald-dark">{c}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
