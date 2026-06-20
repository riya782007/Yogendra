"use client";
import { useState } from "react";
import { isRealImage } from "@/components/Placeholder";

const GRADS = [
  "linear-gradient(135deg,#E7C9D2,#F2EADA,#E2C887)",
  "linear-gradient(135deg,#2E8573,#E6F0ED,#C8A24C)",
  "linear-gradient(135deg,#E2C887,#FAF6EF,#2E8573)",
  "linear-gradient(135deg,#F2EADA,#E7C9D2,#C8A24C)",
];
const KINDS = ["Model", "Flat lay", "Close-up", "Angle"];

export function Gallery({ name, images }: { name: string; images: { path: string; kind?: string | null }[] }) {
  const tiles = (images.length ? images : KINDS.map((k) => ({ path: "", kind: k }))).slice(0, 4);
  const [active, setActive] = useState(0);
  const initials = name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const Tile = ({ i, big }: { i: number; big?: boolean }) => {
    const img = tiles[i];
    if (img && isRealImage(img.path)) return <img src={img.path} alt={name} className="object-cover w-full h-full" />;
    return (
      <div className="w-full h-full grid place-items-center" style={{ background: GRADS[i % 4] }}>
        <span className={`font-display ${big ? "text-6xl" : "text-xl"} text-ink/30`}>{initials}</span>
        {big && <span className="absolute bottom-3 right-4 text-[10px] uppercase tracking-widest text-ink/40">{KINDS[i % 4]}</span>}
      </div>
    );
  };
  return (
    <div>
      <div className="relative aspect-[4/5] rounded-3xl overflow-hidden bg-cream shadow-luxe group">
        <div className="card-img h-full w-full"><Tile i={active} big /></div>
      </div>
      <div className="grid grid-cols-4 gap-2.5 mt-3">
        {tiles.map((_, i) => (
          <button key={i} onClick={() => setActive(i)}
            className={`relative aspect-square rounded-xl overflow-hidden transition-all ${active === i ? "ring-2 ring-emerald" : "ring-1 ring-sand hover:ring-gold"}`}>
            <Tile i={i} />
          </button>
        ))}
      </div>
    </div>
  );
}
