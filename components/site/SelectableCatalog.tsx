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

const esc = (s: string) => (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export type CatalogItem = {
  sku: string; name: string;
  category: string; categorySlug: string;
  subcategory: string | null; subcategorySlug: string | null;
  qty: number; wholesale?: number; price: number; mrp: number; offerPct: number; hasOffer: boolean;
  image: string | null; tags: string[]; keywords: string[]; labels: string[]; wholesaleOnly: boolean;
};

export function SelectableCatalog({ products, view, brand, phone }: { products: CatalogItem[]; view: "retail" | "wholesale"; brand: string; phone: string }) {
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const toggle = (sku: string) =>
    setSel((s) => { const n = new Set(s); n.has(sku) ? n.delete(sku) : n.add(sku); return n; });

  // A shareable link. With a selection → a clean /catalog?skus=… link that shows ONLY those pieces
  // (never the whole inventory). With nothing selected → the current filtered view.
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (sel.size === 0) return window.location.href;
    const u = new URL("/catalog", window.location.origin);
    u.searchParams.set("skus", [...sel].join(","));
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

  /** Build a clean, print-ready catalogue in a hidden IFRAME and trigger the browser's Save-as-PDF.
   *  An iframe is used instead of window.open so pop-up blockers can't silently stop the download.
   *  Uses the selected pieces (or the whole visible catalogue if nothing is selected). */
  function savePdf() {
    const chosen = sel.size ? products.filter((p) => sel.has(p.sku)) : products;
    if (!chosen.length) return;
    const priceOf = (p: CatalogItem) => formatPaise(view === "wholesale" ? (p.wholesale ?? p.price) : p.price);
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
    const cards = chosen.map((p) => `
      <div class="card">
        <div class="imgwrap">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}"/>` : `<div class="ph">No image</div>`}</div>
        <div class="meta">
          <div class="cat">${esc(p.category)}${p.subcategory ? ` › ${esc(p.subcategory)}` : ""}</div>
          <div class="name">${esc(p.name)}</div>
          <div class="sku">${esc(p.sku)}</div>
          <div class="price">${priceOf(p)}${view === "wholesale" ? ` <span class="wtag">wholesale</span>` : ""}</div>
        </div>
      </div>`).join("");
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
  .imgwrap { aspect-ratio: 4/5; background: #f6f3ee; }
  .imgwrap img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .ph { width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#a8a29e; font-size:11px; }
  .meta { padding: 8px 10px 10px; }
  .cat { font-size: 8px; letter-spacing: 1px; text-transform: uppercase; color: #a0823c; }
  .name { font-size: 12.5px; font-weight: 600; line-height: 1.25; margin: 2px 0; }
  .sku { font-size: 10px; color: #78716c; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .price { font-size: 13px; font-weight: 700; margin-top: 4px; }
  .wtag { font-size: 8px; text-transform: uppercase; letter-spacing: .5px; color: #0f766e; font-weight: 600; }
  .foot { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e7e2d9; font-size: 10px; color: #a8a29e; text-align: center; }
</style></head>
<body>
  <div class="head">
    <div class="brand">${esc(brand)}<small>Artificial Jewellery · Curated Catalogue</small></div>
    <div class="meta-r">${chosen.length} design${chosen.length === 1 ? "" : "s"}<br/>${esc(today)}${phone ? `<br/>${esc(phone)}` : ""}</div>
  </div>
  <div class="grid">${cards}</div>
  <div class="foot">${esc(brand)}${phone ? ` · ${esc(phone)}` : ""} — prices ${view === "wholesale" ? "wholesale" : "retail"}, subject to availability.</div>
</body></html>`;
    // Render into a hidden iframe, wait for all images, then print just the iframe.
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
      {/* Toolbar — sharing is selection-aware: with pieces selected, Copy link / WhatsApp / PDF use
          ONLY those pieces; with nothing selected they use the current filtered view. */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
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
          {copied ? "Link copied ✓" : sel.size ? `🔗 Copy link (${sel.size})` : "🔗 Copy link"}
        </button>
        <button onClick={whatsapp} className="px-4 py-2 rounded-full bg-emerald text-white text-sm hover:bg-emerald-dark">
          {sel.size ? `Share ${sel.size} on WhatsApp` : "Share on WhatsApp"}
        </button>
        <button onClick={savePdf} disabled={products.length === 0}
          className="px-4 py-2 rounded-full bg-gold text-ink text-sm font-medium hover:opacity-90 disabled:opacity-40">
          ⬇ Save as PDF{sel.size ? ` (${sel.size})` : ""}
        </button>
      </div>

      {products.length === 0 ? (
        <p className="text-muted text-center py-16">No designs in this catalogue yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => {
            const on = sel.has(p.sku);
            const showPrice = view === "wholesale" ? (p.wholesale ?? p.price) : p.price;
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
                  {p.wholesaleOnly && <span className="absolute bottom-2 left-2 bg-ink/80 text-gold-light text-[10px] px-2 py-0.5 rounded-full">Wholesale only</span>}
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
                  {(p.labels ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {p.labels.slice(0, 3).map((l) => <span key={l} className="text-[9px] px-1.5 py-0.5 rounded-full bg-gold/15 text-gold-dark font-medium">{l}</span>)}
                    </div>
                  )}
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
