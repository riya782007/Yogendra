"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Suggestions = {
  products: { name: string; sku: string }[];
  categories: { name: string; slug: string }[];
  colours: string[];
};
type Hit =
  | { kind: "product"; label: string; sku: string }
  | { kind: "category"; label: string; slug: string }
  | { kind: "colour"; label: string }
  | { kind: "search"; label: string };

/**
 * CatalogSearch — the live search + suggestions box for the shareable catalogue.
 *
 * Typing surfaces matching products (by name OR SKU), categories, and colours, grouped
 * with little type badges. Picking a:
 *   • product   → /catalog?skus=SKU       (catalogue narrowed to that one design)
 *   • category  → /catalog?category=slug
 *   • colour    → /catalog?q=Colour        (keyword search across name/SKU/tags)
 *   • free text → /catalog?q=…             (Enter on whatever was typed)
 * The current retail/wholesale `view` is always preserved so a shared link keeps its pricing.
 */
export function CatalogSearch({
  suggestions,
  view,
  initialQuery = "",
}: {
  suggestions: Suggestions;
  view: "retail" | "wholesale";
  initialQuery?: string;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const viewQ = view === "wholesale" ? "&view=wholesale" : "";

  const hits = useMemo<Hit[]>(() => {
    const q = term.trim().toLowerCase();
    if (!q) return [];
    const out: Hit[] = [];
    // Products: name or SKU contains the term.
    for (const p of suggestions.products) {
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        out.push({ kind: "product", label: p.name, sku: p.sku });
      }
      if (out.length >= 8) break;
    }
    // Categories.
    for (const c of suggestions.categories) {
      if (c.name.toLowerCase().includes(q)) out.push({ kind: "category", label: c.name, slug: c.slug });
    }
    // Colours.
    for (const col of suggestions.colours) {
      if (col.toLowerCase().includes(q)) out.push({ kind: "colour", label: col });
      if (out.length >= 14) break;
    }
    // Always offer a raw keyword search as the last option.
    out.push({ kind: "search", label: term.trim() });
    return out.slice(0, 14);
  }, [term, suggestions]);

  function go(hit: Hit) {
    setOpen(false);
    if (hit.kind === "product") router.push(`/catalog?skus=${encodeURIComponent(hit.sku)}${viewQ}`);
    else if (hit.kind === "category") router.push(`/catalog?category=${encodeURIComponent(hit.slug)}${viewQ}`);
    else if (hit.kind === "colour") router.push(`/catalog?q=${encodeURIComponent(hit.label)}${viewQ}`);
    else router.push(`/catalog?q=${encodeURIComponent(hit.label)}${viewQ}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { setOpen(true); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hits[active]) go(hits[active]); else if (term.trim()) go({ kind: "search", label: term.trim() }); }
    else if (e.key === "Escape") setOpen(false);
  }

  const BADGE: Record<string, string> = {
    product: "bg-emerald-mist text-emerald-dark",
    category: "bg-gold/15 text-gold-dark",
    colour: "bg-wine/10 text-wine",
    search: "bg-ink/10 text-ink",
  };

  return (
    <div ref={boxRef} className="no-print relative w-full sm:w-96">
      <div className="flex items-center gap-2 rounded-full bg-white/95 border border-sand px-4 py-2 shadow-sm focus-within:border-gold">
        <span className="text-muted text-sm" aria-hidden>🔍</span>
        <input
          value={term}
          onChange={(e) => { setTerm(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => term.trim() && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search a design, SKU, category or colour…"
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          aria-label="Search the catalogue"
        />
        {term && (
          <button type="button" onClick={() => { setTerm(""); setOpen(false); router.push(`/catalog${view === "wholesale" ? "?view=wholesale" : ""}`); }} className="text-muted hover:text-ink text-sm" aria-label="Clear search">✕</button>
        )}
      </div>

      {open && hits.length > 0 && (
        <ul className="absolute z-30 mt-2 w-full max-h-80 overflow-y-auto rounded-2xl bg-white border border-sand shadow-luxe py-1 text-left">
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.label}-${i}`}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm ${i === active ? "bg-cream" : "hover:bg-cream/60"}`}
              >
                <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full shrink-0 ${BADGE[h.kind]}`}>
                  {h.kind === "search" ? "search" : h.kind}
                </span>
                <span className="truncate text-ink">
                  {h.kind === "product" ? <>{h.label} <span className="text-muted font-mono text-xs">{(h as any).sku}</span></>
                    : h.kind === "search" ? <>Search for “{h.label}”</>
                    : h.label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
