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
  // Owner, Nov 2026 (Returns page video): "I am not doing anything and the list keeps changing". Each
  // keystroke fired a search, and the answers came back OUT OF ORDER — the list for "kpe" landed after
  // the one for "kpe5815" and replaced it. Only the answer for the latest text is shown now.
  const seqRef = useRef(0);
  const typedRef = useRef(false);

  useEffect(() => {
    const my = ++seqRef.current;
    if (justPicked) { setJustPicked(false); return; } // don't re-search the value we just selected
    // Only search what the person TYPED — not a value the page filled in itself (e.g. the canonical SKU
    // after a lookup), which popped the list open while nobody was touching the keyboard.
    if (!typedRef.current) { setOpen(false); return; }
    const q = value.trim();
    if (q.length < 2) { setOpts([]); setOpen(false); return; }
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      try {
        const r = await searchSkusAction(q);
        if (my !== seqRef.current) return; // a newer keystroke has superseded this answer
        setOpts(r); setHi(0); setOpen(r.length > 0);
      } catch { /* ignore */ }
    }, 250);
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
        onChange={(e) => { typedRef.current = true; onChange(e.target.value); }}
        onBlur={() => { typedRef.current = false; }}
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

/**
 * Self-contained SKU box for plain server-action <form>s — manages its own state and submits the picked
 * SKU via a hidden input named `name`. Use where there's no React state to bind (stock adjust, quick add).
 */
export function SkuFormInput({
  name, defaultValue = "", placeholder, className,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [v, setV] = useState(defaultValue);
  return (
    <>
      <input type="hidden" name={name} value={v} />
      <SkuInput value={v} onChange={setV} placeholder={placeholder} className={className} />
    </>
  );
}
