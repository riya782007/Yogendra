"use client";

import { useState, type ReactNode } from "react";

/**
 * CollapsibleCategory — an accordion wrapper for one category card on the Categories
 * page. The header (name, slug, design count, delete) is always visible and toggles the
 * body (subcategory chips + add-subcategory form) open/closed.
 *
 * The header and body are passed as server-rendered children (they contain server-action
 * <form>s), so this client component only owns the open/closed state. Remembers the last
 * open/closed choice per category in localStorage so a long list stays the way the owner
 * left it across navigations.
 */
export function CollapsibleCategory({
  id,
  title,
  meta,
  designCount,
  subCount,
  actions,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  meta: string;
  designCount: number;
  subCount: number;
  actions?: ReactNode;
  children?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-2xl shadow-card hover:shadow-luxe transition-shadow overflow-hidden">
      {/* Header row — click anywhere (except the action buttons) to expand/collapse. */}
      <div className="flex items-center justify-between gap-3 p-5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-3 min-w-0 flex-1 text-left group"
        >
          <span className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden>▸</span>
          <span className="min-w-0">
            <span className="block font-medium text-ink text-lg truncate group-hover:text-emerald-dark transition-colors">{title}</span>
            <span className="block text-xs text-muted">{meta}</span>
          </span>
          <span className="ml-2 shrink-0 text-[11px] rounded-full bg-emerald-mist/60 text-emerald-dark px-2 py-0.5">
            {subCount} sub{subCount === 1 ? "" : "s"}
          </span>
        </button>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm text-emerald font-medium whitespace-nowrap">{designCount} designs</span>
          {actions}
        </div>
      </div>

      {/* Body — collapsible. Kept mounted only when open to keep the DOM light. */}
      {open && <div className="px-5 pb-5 border-t border-sand/50 pt-4">{children}</div>}
    </div>
  );
}
