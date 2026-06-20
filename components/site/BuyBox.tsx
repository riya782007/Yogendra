"use client";
import { useState } from "react";

export function BuyBox({ colors, waText, waHref }: { colors: string[]; waText: string; waHref: string }) {
  const [color, setColor] = useState(colors[0] ?? "");
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  return (
    <div className="mt-6">
      {colors.length > 0 && (
        <div className="mb-5">
          <p className="text-sm font-medium text-ink mb-2">Colour: <span className="text-muted font-normal">{color}</span></p>
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={`px-3.5 py-1.5 rounded-full text-sm border transition-all ${color === c ? "border-emerald bg-emerald-mist text-emerald" : "border-sand text-ink/70 hover:border-gold"}`}>{c}</button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-sm font-medium text-ink">Qty</span>
        <div className="inline-flex items-center rounded-full border border-sand overflow-hidden">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-1.5 hover:bg-cream transition-colors">−</button>
          <span className="px-4 text-sm">{qty}</span>
          <button onClick={() => setQty((q) => q + 1)} className="px-3 py-1.5 hover:bg-cream transition-colors">+</button>
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => { setAdded(true); setTimeout(() => setAdded(false), 1600); }}
          className="btn-primary flex-1 py-3.5 text-sm font-medium">
          {added ? "✓ Added to cart" : "Add to cart"}
        </button>
        <a href={waHref} target="_blank" rel="noreferrer"
          className="px-5 py-3.5 rounded-full bg-[#25D366] text-white text-sm font-medium transition-transform hover:-translate-y-0.5 active:scale-95">WhatsApp</a>
      </div>
      <p className="text-xs text-muted mt-3 flex items-center gap-4">
        <span>✓ COD available</span><span>✓ Free shipping over ₹999</span><span>✓ 7-day returns</span>
      </p>
    </div>
  );
}
