"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { isRealImage } from "@/components/Placeholder";

const GRAD = "linear-gradient(135deg,#E7C9D2,#F2EADA,#E2C887)";

/**
 * Product gallery for a jewellery storefront.
 *  - Shows only REAL photos (no fake multi-tile blocks). One elegant placeholder if none.
 *  - Click the hero to open a full-screen lightbox with click/scroll zoom and prev/next —
 *    so buyers can inspect stone-setting, polish and detail (Shopping-Tree style).
 */
// Variant images arrive with kind = the colour name; product images use a fixed set of
// kinds. Return the colour label for variant images, else null (so we badge colours only).
const PRODUCT_KINDS = new Set(["model", "source", "flatlay", "gallery", "hero", "ai", "image", ""]);
function colorLabel(kind?: string | null): string | null {
  const k = (kind ?? "").trim();
  if (!k || PRODUCT_KINDS.has(k.toLowerCase())) return null;
  return k;
}

export function Gallery({ name, images }: { name: string; images: { path: string; kind?: string | null }[] }) {
  const real = images.filter((i) => isRealImage(i.path));
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  if (real.length === 0) {
    return (
      <div className="aspect-[3/4] rounded-3xl overflow-hidden bg-cream shadow-luxe grid place-items-center relative" style={{ background: GRAD }}>
        <span className="font-display text-7xl text-ink/25">{initials}</span>
        <span className="absolute bottom-4 left-0 right-0 text-center text-[11px] uppercase tracking-widest text-ink/40">Photo coming soon</span>
      </div>
    );
  }

  const cur = real[Math.min(active, real.length - 1)];
  const curColor = colorLabel(cur.kind);
  return (
    <div>
      <button onClick={() => setOpen(true)} aria-label="Zoom image"
        className="relative aspect-[3/4] w-full rounded-3xl overflow-hidden bg-cream shadow-luxe group cursor-zoom-in block">
        {/* object-CONTAIN on the main product image so the WHOLE jewellery piece is always visible — never
            cropped. A 3:4 upload fills the 3:4 frame exactly (no margins); an odd-ratio photo shows complete
            on the neutral cream background instead of hiding part of the piece. */}
        <img src={cur.path} alt={curColor ? `${name} — ${curColor}` : name} className="object-contain w-full h-full transition-transform duration-500 group-hover:scale-105" />
        {curColor && (
          <span className="absolute top-3 left-3 text-[11px] font-medium text-ink bg-white/90 px-2.5 py-1 rounded-full shadow-sm capitalize">{curColor}</span>
        )}
        <span className="absolute bottom-3 right-3 h-9 w-9 rounded-full bg-white/85 grid place-items-center text-ink text-sm shadow group-hover:scale-110 transition-transform">⤢</span>
        <span className="absolute bottom-3 left-3 text-[11px] text-white/0 group-hover:text-white/90 bg-ink/0 group-hover:bg-ink/40 px-2 py-1 rounded-full transition-all">Tap to zoom</span>
      </button>
      {real.length > 1 && (
        <div className="grid grid-cols-5 gap-2.5 mt-3">
          {real.slice(0, 10).map((img, i) => {
            const col = colorLabel(img.kind);
            return (
              <button key={i} onClick={() => setActive(i)} aria-label={col ? `View ${col}` : `View image ${i + 1}`} title={col ?? undefined}
                className={`relative aspect-square rounded-xl overflow-hidden transition-all ${active === i ? "ring-2 ring-emerald" : "ring-1 ring-sand hover:ring-gold"}`}>
                <img src={img.path} alt={col ? `${name} ${col}` : `${name} ${i + 1}`} className="object-cover w-full h-full" />
                {col && (
                  <span className="absolute bottom-0 inset-x-0 bg-ink/55 text-white text-[9px] leading-tight py-0.5 text-center capitalize truncate px-0.5">{col}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {open && <Lightbox images={real} start={active} name={name} onClose={() => setOpen(false)} />}
    </div>
  );
}

const MAX_ZOOM = 5;

function Lightbox({ images, start, name, onClose }: { images: { path: string }[]; start: number; name: string; onClose: () => void }) {
  const [idx, setIdx] = useState(start);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // pan offset in px (applied with the zoom)
  const boxRef = useRef<HTMLDivElement>(null);
  // Pointer-drag panning; `moved` suppresses the tap-to-zoom that would otherwise fire on release.
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean; active: boolean }>({ sx: 0, sy: 0, ox: 0, oy: 0, moved: false, active: false });

  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };
  const next = () => { setIdx((i) => (i + 1) % images.length); reset(); };
  const prev = () => { setIdx((i) => (i - 1 + images.length) % images.length); reset(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [images.length]);

  /** Keep the panned image from being dragged completely out of view. */
  function clamp(p: { x: number; y: number }, s: number) {
    const el = boxRef.current;
    if (!el) return p;
    const r = el.getBoundingClientRect();
    const maxX = ((s - 1) * r.width) / 2;
    const maxY = ((s - 1) * r.height) / 2;
    return { x: Math.max(-maxX, Math.min(maxX, p.x)), y: Math.max(-maxY, Math.min(maxY, p.y)) };
  }

  /** Zoom to a new scale while keeping the point under (clientX, clientY) fixed on screen. */
  function zoomTo(newScale: number, clientX?: number, clientY?: number) {
    const el = boxRef.current;
    const s = Math.min(MAX_ZOOM, Math.max(1, Math.round(newScale * 100) / 100));
    if (!el || s === 1) { setScale(s); setPos({ x: 0, y: 0 }); return; }
    const r = el.getBoundingClientRect();
    const cx = (clientX ?? r.left + r.width / 2) - (r.left + r.width / 2);
    const cy = (clientY ?? r.top + r.height / 2) - (r.top + r.height / 2);
    setScale((prevS) => {
      const ratio = s / prevS;
      setPos((prev) => clamp({ x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio }, s));
      return s;
    });
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    zoomTo(scale + (e.deltaY < 0 ? 0.4 : -0.4), e.clientX, e.clientY);
  }
  function onPointerDown(e: React.PointerEvent) {
    if (scale <= 1) return; // only pan when zoomed in
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false, active: true };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.active) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setPos(clamp({ x: d.ox + dx, y: d.oy + dy }, scale));
  }
  function onPointerUp() { drag.current.active = false; }
  function onImgClick(e: React.MouseEvent) {
    if (drag.current.moved) { drag.current.moved = false; return; } // was a pan, not a tap
    if (scale > 1) zoomTo(1);
    else zoomTo(2.5, e.clientX, e.clientY); // zoom in on the tapped detail
  }

  const zoomed = scale > 1;
  // PORTAL to <body>: the product page wraps sections in scroll-reveal animations that apply a CSS
  // transform, and a transformed ancestor hijacks position:fixed — the lightbox was getting trapped
  // inside the gallery box, letting the page's buttons/variant chips paint on top of the enlarged
  // photo. Rendering at the document root makes it a true full-screen overlay above everything.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-ink/92 backdrop-blur-sm grid place-items-center animate-fadeIn" onClick={onClose}>
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-5 z-10 text-cream/80 hover:text-white text-3xl leading-none">✕</button>
      <div
        ref={boxRef}
        className="relative max-w-[94vw] max-h-[90vh] overflow-hidden touch-none"
        onClick={(e) => e.stopPropagation()}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <img src={images[idx].path} alt={name}
          onClick={onImgClick}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, cursor: zoomed ? (drag.current.active ? "grabbing" : "grab") : "zoom-in", transition: drag.current.active ? "none" : "transform 0.18s" }}
          className="max-w-[94vw] max-h-[90vh] object-contain select-none" draggable={false} />
      </div>

      {/* Zoom controls — work on touch too (where there's no scroll wheel). */}
      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => zoomTo(scale - 0.5)} aria-label="Zoom out" className="h-10 w-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl grid place-items-center disabled:opacity-30" disabled={!zoomed}>−</button>
        <button onClick={() => reset()} aria-label="Reset zoom" className="px-3 h-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xs grid place-items-center">{Math.round(scale * 100)}%</button>
        <button onClick={() => zoomTo(scale + 0.5)} aria-label="Zoom in" className="h-10 w-10 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl grid place-items-center disabled:opacity-30" disabled={scale >= MAX_ZOOM}>+</button>
      </div>

      {images.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous" className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl grid place-items-center">‹</button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next" className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl grid place-items-center">›</button>
        </>
      )}
      <p className="absolute bottom-4 left-0 right-0 text-center text-cream/70 text-xs">
        {zoomed ? "Drag to move around · tap to reset" : "Scroll, tap, or +/− to zoom in"} · {idx + 1}/{images.length}
      </p>
    </div>,
    document.body
  );
}
