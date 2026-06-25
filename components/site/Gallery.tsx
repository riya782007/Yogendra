"use client";
import { useState, useEffect } from "react";
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
      <div className="aspect-[4/5] rounded-3xl overflow-hidden bg-cream shadow-luxe grid place-items-center relative" style={{ background: GRAD }}>
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
        className="relative aspect-[4/5] w-full rounded-3xl overflow-hidden bg-cream shadow-luxe group cursor-zoom-in block">
        <img src={cur.path} alt={curColor ? `${name} — ${curColor}` : name} className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105" />
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

function Lightbox({ images, start, name, onClose }: { images: { path: string }[]; start: number; name: string; onClose: () => void }) {
  const [idx, setIdx] = useState(start);
  const [scale, setScale] = useState(1);
  const next = () => { setIdx((i) => (i + 1) % images.length); setScale(1); };
  const prev = () => { setIdx((i) => (i - 1 + images.length) % images.length); setScale(1); };

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

  function wheelZoom(e: React.WheelEvent) {
    e.preventDefault();
    setScale((s) => Math.min(3.5, Math.max(1, s + (e.deltaY < 0 ? 0.3 : -0.3))));
  }

  return (
    <div className="fixed inset-0 z-[100] bg-ink/92 backdrop-blur-sm grid place-items-center animate-fadeIn" onClick={onClose}>
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-5 z-10 text-cream/80 hover:text-white text-3xl leading-none">✕</button>
      <div className="relative max-w-[94vw] max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()} onWheel={wheelZoom}>
        <img src={images[idx].path} alt={name}
          onClick={() => setScale((s) => (s >= 2.5 ? 1 : s + 0.75))}
          style={{ transform: `scale(${scale})`, cursor: scale > 1 ? "zoom-out" : "zoom-in" }}
          className="max-w-[94vw] max-h-[90vh] object-contain transition-transform duration-200 select-none" draggable={false} />
      </div>
      {images.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous" className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl grid place-items-center">‹</button>
          <button onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next" className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full bg-white/15 hover:bg-white/30 text-white text-2xl grid place-items-center">›</button>
        </>
      )}
      <p className="absolute bottom-4 left-0 right-0 text-center text-cream/70 text-xs">Scroll or tap the image to zoom · {idx + 1}/{images.length}</p>
    </div>
  );
}
