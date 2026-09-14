"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "./Icons";

type Hit = { kind: string; label: string; href: string };

/**
 * Search input on /search — with live category/product dropdown while typing.
 * Owner: typeahead was missing ("Ne likho to necklaces ka dropdown ana chahiye").
 * Native form GET still works if JS is slow (WhatsApp in-app browser).
 */
export function SearchField({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [term, setTerm] = useState(initial);
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const tRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (tRef.current) clearTimeout(tRef.current);
    const q = term.trim();
    if (!q) {
      setHits([]);
      setOpen(false);
      return;
    }
    tRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search-suggest?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        if (!r.ok) return;
        const d = await r.json();
        const list: Hit[] = d.hits ?? [];
        setHits(list);
        setOpen(list.length > 0);
        setActive(0);
      } catch {
        /* ignore */
      }
    }, 180);
    return () => {
      if (tRef.current) clearTimeout(tRef.current);
    };
  }, [term]);

  function go(hit: Hit) {
    setOpen(false);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter") && hits.length) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && hits[active]) {
        e.preventDefault();
        go(hits[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const BADGE: Record<string, string> = {
    product: "bg-emerald-mist text-emerald-dark",
    category: "bg-gold/15 text-gold-dark",
    colour: "bg-wine/10 text-wine",
    search: "bg-ink/10 text-ink",
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-xl">
      <form
        action="/search"
        method="get"
        className="flex items-center gap-2 rounded-full border border-sand bg-white px-4 py-2.5 shadow-sm focus-within:border-emerald"
        onSubmit={() => setOpen(false)}
      >
        <IconSearch className="w-5 h-5 text-ink/50 shrink-0" />
        <input
          name="q"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => hits.length && setOpen(true)}
          onKeyDown={onKeyDown}
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          placeholder="Search designs, colours, categories…"
          className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink/40"
          aria-label="Search jewellery"
          aria-autocomplete="list"
          aria-expanded={open}
        />
        <button type="submit" className="shrink-0 rounded-full bg-emerald text-white text-sm font-medium px-4 py-1.5 hover:opacity-90">
          Search
        </button>
      </form>

      {open && hits.length > 0 && (
        <ul
          className="absolute z-30 mt-2 w-full max-h-80 overflow-y-auto rounded-2xl bg-white border border-sand shadow-luxe py-1 text-left"
          role="listbox"
        >
          {hits.map((h, i) => (
            <li key={`${h.kind}-${h.label}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                  i === active ? "bg-cream" : "hover:bg-cream/70"
                }`}
              >
                <span className="truncate text-ink">{h.label}</span>
                <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${BADGE[h.kind] ?? BADGE.search}`}>
                  {h.kind}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
