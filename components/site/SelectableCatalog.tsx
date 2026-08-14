"use client";
/**
 * SelectableCatalog — the shareable catalogue grid (Phase 5).
 *
 * Two modes:
 *   • manage (owner composing a link): retail/wholesale is chosen on the page header; select-to-share
 *     builds a customer URL that LOCKS that pricing and never includes the toggle.
 *   • customer (opened from a shared link): prices only, in-stock variants in a dropdown, no
 *     retail/wholesale toggle or tags.
 */
import { useMemo, useState } from "react";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";

const esc = (s: string) => (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export type CatalogItem = {
  sku: string; name: string;
  category: string; categorySlug: string;
  subcategory: string | null; subcategorySlug: string | null;
  qty: number; wholesale?: number; price: number; mrp: number; offerPct: number; hasOffer: boolean;
  image: string | null; tags: string[]; keywords: string[]; labels: string[]; wholesaleOnly: boolean;
  colors?: string[];
  variants?: { sku: string; color: string; image: string | null }[];
};

function CatalogCard({
  p, picking, on, onToggle, showPrice, showOffer, manage,
}: {
  p: CatalogItem; picking: boolean; on: boolean; onToggle: () => void;
  showPrice: number; showOffer: boolean; manage: boolean;
}) {
  const variants = (p.variants ?? []).filter((v) => v.color || v.sku);
  const [picked, setPicked] = useState<string>("");
  const active = variants.find((v) => v.sku === picked) ?? null;
  const img = (active?.image && active.image.startsWith("http") ? active.image : null) ?? p.image;
  const skuShown = active?.sku || p.sku;

  return (
    <div
      onClick={picking ? onToggle : undefined}
      className={`bg-white rounded-2xl overflow-hidden border shadow-card break-inside-avoid transition-all ${picking ? "cursor-pointer" : ""} ${on ? "border-emerald ring-2 ring-emerald/40" : "border-sand"}`}>
      <div className="aspect-[3/4] bg-cream relative">
        <ProductImage src={img} name={p.name} />
        {picking && (
          <span className={`absolute top-2 left-2 h-6 w-6 rounded-full grid place-items-center text-xs ${on ? "bg-emerald text-white" : "bg-white/80 text-ink border border-sand"}`}>{on ? "✓" : ""}</span>
        )}
        {!picking && showOffer && <span className="absolute top-2 left-2 bg-rose text-white text-[10px] px-2 py-0.5 rounded-full">{p.offerPct}% OFF</span>}
        {manage && p.wholesaleOnly && <span className="absolute bottom-2 left-2 bg-ink/80 text-gold-light text-[10px] px-2 py-0.5 rounded-full">Wholesale only</span>}
        {p.qty <= 0 && <span className="absolute top-2 right-2 bg-ink/80 text-cream text-[10px] px-2 py-0.5 rounded-full">Out</span>}
        {p.qty > 0 && p.qty <= 3 && <span className="absolute top-2 right-2 bg-gold text-ink text-[10px] px-2 py-0.5 rounded-full">Only {p.qty}</span>}
      </div>
      <div className="p-3">
        <p className="text-[10px] uppercase tracking-wide text-gold-dark">{p.category}{p.subcategory ? ` › ${p.subcategory}` : ""}</p>
        <p className="text-sm font-medium text-ink leading-tight mt-0.5 line-clamp-2">{p.name}</p>
        <p className="text-[11px] text-muted font-mono mt-0.5">{skuShown}</p>
        <div className="flex items-baseline gap-1.5 mt-1">
          <span className="text-base font-semibold text-ink">{formatPaise(showPrice)}</span>
          {showOffer ? <span className="text-xs text-muted line-through">{formatPaise(p.mrp)}</span> : null}
        </div>
        {variants.length > 1 && (
          <label className="block mt-2 text-[9px] uppercase tracking-wide text-muted" onClick={(e) => e.stopPropagation()}>
            Colour
            <select
              value={active?.sku ?? ""}
              onChange={(e) => setPicked(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-sand bg-white px-2 py-1.5 text-xs text-ink outline-none focus:border-gold"
            >
              <option value="">All colours · {p.sku}</option>
              {variants.map((v) => (
                <option key={v.sku} value={v.sku}>{v.color}{v.sku && v.sku !== p.sku ? ` · ${v.sku}` : ""}</option>
              ))}
            </select>
          </label>
        )}
        {variants.length === 1 && variants[0].color && (
          <p className="text-[11px] text-muted mt-1.5">Colour: {variants[0].color}</p>
        )}
        {(p.labels ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {p.labels.slice(0, 3).map((l) => <span key={l} className="text-[9px] px-1.5 py-0.5 rounded-full bg-gold/15 text-gold-dark font-medium">{l}</span>)}
          </div>
        )}
        {([...new Set([...(p.tags ?? []), ...(p.keywords ?? [])])].slice(0, 4)).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {[...new Set([...(p.tags ?? []), ...(p.keywords ?? [])])].slice(0, 4).map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-mist text-emerald-dark">{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

export function SelectableCatalog({ products, view, brand, phone, manage = false }: { products: CatalogItem[]; view: "retail" | "wholesale"; brand: string; phone: string; manage?: boolean }) {
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const toggle = (sku: string) =>
    setSel((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });

  // Customer-facing URL: lock the current price mode via ?view=wholesale when needed, NEVER include
  // manage=1 (that flag is only for the owner composing the catalogue).
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const u = new URL("/catalog", window.location.origin);
    const cur = new URL(window.location.href);
    for (const k of ["category", "subcategory", "style", "q"] as const) {
      const v = cur.searchParams.get(k);
      if (v) u.searchParams.set(k, v);
    }
    if (sel.size > 0) u.searchParams.set("skus", [...sel].join(","));
    else {
      const skus = cur.searchParams.get("skus");
      if (skus) u.searchParams.set("skus", skus);
    }
    if (view === "wholesale") u.searchParams.set("view", "wholesale");
    return u.toString();
  }, [sel, view]);

  const copy = () => { if (shareUrl) navigator.clipboard?.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {}); };
  const whatsapp = () => {
    if (!shareUrl) return;
    const label = sel.size ? `${brand} — ${sel.size} pieces` : `${brand} — catalogue`;
    window.open(`https://wa.me/?text=${encodeURIComponent(`${label}\n${shareUrl}`)}`, "_blank");
  };

  const selectAll = () => setSel(new Set(products.map((p) => p.sku)));
  const clearAll = () => setSel(new Set());
  const allSelected = products.length > 0 && sel.size === products.length;

  function savePdf() {
    const chosen = sel.size ? products.filter((p) => sel.has(p.sku)) : products;
    if (!chosen.length) return;
    const priceOf = (p: CatalogItem) => formatPaise(view === "wholesale" ? (p.wholesale ?? p.price) : p.price);
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const cards = chosen.map((p) => {
      const colours = (p.variants ?? []).map((v) => v.color).filter(Boolean);
      const colourLine = colours.length ? `<div class="cols">${esc(colours.join(" · "))}</div>` : "";
      return `
      <div class="card">
        <div class="imgwrap">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}"/>` : `<div class="ph">No image</div>`}</div>
        <div class="meta">
          <div class="cat">${esc(p.category)}${p.subcategory ? ` › ${esc(p.subcategory)}` : ""}</div>
          <div class="name">${esc(p.name)}</div>
          <div class="sku">${esc(p.sku)}</div>
          ${colourLine}
          <div class="price">${priceOf(p)}</div>
        </div>
      </div>`;
    }).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<title>${esc(brand)} — Catalogue</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1c1917; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1c1917; padding-bottom: 10px; margin-bottom: 18px; }
  .brand { font-family: Georgia, "Times New Roman", serif; font-size: 26px; font-weight: 600; letter-spacing: .3px; }
  .brand small { display:block; font-family: Georgia, serif; font-size: 10px; letter-spacing: 3px; text-transform: uppercase; color: #a0823c; font-weight: 400; margin-top: 2px; }
  .meta-r { text-align: right; font-size: 11px; color: #78716c; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .card { border: 1px solid #e7e2d9; border-radius: 10px; overflow: hidden; page-break-inside: avoid; break-inside: avoid; }
  .imgwrap { aspect-ratio: 3/4; background: #f6f3ee; }
  .imgwrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:11px; }
  .meta { padding: 8px 10px 10px; }
  .cat { font-size: 8px; letter-spacing: 1px; text-transform: uppercase; color: #a0823c; }
  .name { font-size: 12.5px; font-weight: 600; line-height: 1.25; margin: 2px 0; }
  .sku { font-size: 10px; color: #78716c; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .cols { font-size: 9px; color: #57534e; margin-top: 2px; }
  .price { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e7e2d9; font-size: 10px; color: #a8a29e; text-align: center; }
</style></head>
<body>
  <div class="head">
    <div class="brand">${esc(brand)}<small>Artificial Jewellery · Curated Catalogue</small></div>
    <div class="meta-r">${chosen.length} design${chosen.length === 1 ? "" : "s"}<br/>${esc(today)}${phone ? `<br/>${esc(phone)}` : ""}</div>
  </div>
  <div class="grid">${cards}</div>
  <div class="foot">${esc(brand)}${phone ? ` · ${esc(phone)}` : ""} — prices subject to availability.</div>
</body></html>`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);
    const doc = iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); return; }
    doc.open(); doc.write(html); doc.close();
    const cleanup = () => setTimeout(() => iframe.remove(), 1000);
    const go = () => { try { iframe.contentWindow?.focus(); iframe.contentWindow?.print(); } finally { cleanup(); } };
    const imgs = Array.from(doc.images);
    let left = imgs.length;
    if (!left) { setTimeout(go, 150); return; }
    const tick = () => { if (--left <= 0) setTimeout(go, 200); };
    imgs.forEach((im) => { if (im.complete) tick(); else { im.onload = tick; im.onerror = tick; } });
  }

  return (
    <div>
      {manage && (
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        <p className="w-full text-[11px] text-muted">You are composing a catalogue. Copy / WhatsApp sends a customer link with these prices locked — they will not see Retail or Wholesale.</p>
        <button onClick={() => { setPicking((p) => !p); setSel(new Set()); }}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${picking ? "bg-ink text-white" : "bg-white border border-sand text-ink hover:border-gold"}`}>
          {picking ? "✓ Selecting — tap pieces" : "✷ Select pieces to share"}
        </button>
        {picking && (
          <>
            <button onClick={allSelected ? clearAll : selectAll}
              className="px-4 py-2 rounded-full bg-white border border-sand text-ink text-sm hover:border-gold">
              {allSelected ? "✕ Clear all" : `✓ Select all (${products.length})`}
            </button>
            <span className="text-sm text-muted">{sel.size} selected</span>
          </>
        )}
        <button onClick={copy} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">
          {copied ? "Link copied ✓" : sel.size ? `🔗 Copy customer link (${sel.size})` : "🔗 Copy customer link"}
        </button>
        <button onClick={whatsapp} className="px-4 py-2 rounded-full bg-emerald text-white text-sm hover:bg-emerald-dark">
          {sel.size ? `Share ${sel.size} on WhatsApp` : "Share on WhatsApp"}
        </button>
        <button onClick={savePdf} disabled={products.length === 0}
          className="px-4 py-2 rounded-full bg-gold text-ink text-sm font-medium hover:opacity-90 disabled:opacity-40">
          ⬇ Save as PDF{sel.size ? ` (${sel.size})` : ""}
        </button>
      </div>
      )}

      {products.length === 0 ? (
        <p className="text-muted text-center py-16">No designs in this catalogue yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => {
            const showPrice = view === "wholesale" ? (p.wholesale ?? p.price) : p.price;
            return (
              <CatalogCard
                key={p.sku}
                p={p}
                picking={picking}
                on={sel.has(p.sku)}
                onToggle={() => toggle(p.sku)}
                showPrice={showPrice}
                showOffer={!picking && p.hasOffer && view === "retail"}
                manage={manage}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
