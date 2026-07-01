"use client";
/**
 * FiltersPanel — collapses the whole storefront filter set behind one "Filters" button so the
 * product grid is visible immediately (no scrolling past dozens of colour/category chips).
 * Active filters stay visible as removable chips even when the panel is closed.
 */
import { useState, type ReactNode } from "react";

export function FiltersPanel({
  activeCount,
  activeChips = [],
  clearHref,
  children,
}: {
  activeCount: number;
  activeChips?: { label: string; href: string }[];
  clearHref?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-ink text-white text-sm hover:bg-ink/90 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 5h18M6 12h12M10 19h4" strokeLinecap="round" />
          </svg>
          Filters
          {activeCount > 0 && <span className="grid place-items-center min-w-5 h-5 px-1 rounded-full bg-white/20 text-xs">{activeCount}</span>}
          <span className="text-[10px] opacity-80">{open ? "▲" : "▼"}</span>
        </button>

        {/* Active filters — removable, always visible */}
        {activeChips.map((c) => (
          <a key={c.label} href={c.href}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full border border-emerald bg-emerald-mist text-emerald text-xs hover:bg-emerald-mist/70">
            {c.label}<span className="text-emerald/60">✕</span>
          </a>
        ))}
        {activeCount > 0 && clearHref && (
          <a href={clearHref} className="text-xs text-rose hover:underline ml-1">Clear all</a>
        )}
      </div>

      {open && (
        <div className="mt-3 bg-white rounded-2xl shadow-card p-4 sm:p-5 space-y-3 animate-[fadeIn_.15s_ease]">
          {children}
        </div>
      )}
    </div>
  );
}
