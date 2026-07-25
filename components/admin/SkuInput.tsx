"use client";
import { useEffect, useRef, useState } from "react";
import { searchSkusAction, type SkuHit } from "@/app/actions/skuSearch";

/**
 * SKU box with a live matching dropdown — type a few letters of the SKU or product name and pick from
 * the list (owner: "SKU type karte hi list khul jaaye, taaki galti na ho"). Drop-in replacement for a
 * plain <input>: pass value + onChange. Queries the server (debounced) so it never loads the whole
 * catalogue. Keyboard: ↑/↓ to move, Enter to pick, Esc to close.
 */
export function SkuInput({
  value, onChange, placeholder, className, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  const [opts, setOpts] = useState<SkuHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [justPicked, setJustPicked] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (justPicked) { setJustPicked(false); return; } // don't re-search the value we just selected
    const q = value.trim();
    if (q.length < 2) { setOpts([]); setOpen(false); return; }
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      try {
        const r = await searchSkusAction(q);
        setOpts(r); setHi(0); setOpen(r.length > 0);
      } catch { /* ignore */ }
    }, 180);
    return () => { if (tRef.current) clearTimeout(tRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (s: string) => { setJustPicked(true); onChange(s); setOpen(false); setOpts([]); };

  return (
    <div ref={boxRef} className="relative">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (opts.length) setOpen(true); }}
        onKeyDown={(e) => {
          if (!open || !opts.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(opts.length - 1, h + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
          else if (e.key === "Enter") { e.preventDefault(); pick(opts[hi].sku); }
          else if (e.key === "Escape") setOpen(false);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        className={className}
      />
      {open && opts.length > 0 && (
        <ul className="absolute z-40 left-0 right-0 mt-1 max-h-60 overflow-auto rounded-xl border border-sand bg-white shadow-luxe text-sm">
          {opts.map((o, i) => (
            <li
              key={o.sku}
              onMouseDown={(e) => { e.preventDefault(); pick(o.sku); }}
              onMouseEnter={() => setHi(i)}
              className={`px-3 py-2 cursor-pointer flex items-baseline gap-2 ${i === hi ? "bg-emerald-mist" : "hover:bg-cream"}`}
            >
              <span className="font-mono text-ink whitespace-nowrap">{o.sku}</span>
              {o.name ? <span className="text-muted truncate">· {o.name}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
