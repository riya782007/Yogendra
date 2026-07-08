"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconMenu } from "./Icons";

type Cat = { name: string; slug: string; subcategories?: { name: string; slug: string }[] };

export function MobileMenu({ categories }: { categories: Cat[] }) {
  const [open, setOpen] = useState(false);
  // Portal + scroll-lock: the drawer must escape the header's `backdrop-blur` wrapper, otherwise its
  // `position: fixed` is trapped inside the header box and the hero bleeds through (the reported glitch).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Hide the internal "Uncategorized" bucket from shoppers (owner: it's not a real category).
  const cats = categories.filter((c) => c.name?.trim().toLowerCase() !== "uncategorized");

  const drawer = (
    <div className="fixed inset-0 z-[100]">
      <div className="absolute inset-0 bg-ink/50 animate-fadeIn" onClick={() => setOpen(false)} />
      <div className="absolute left-0 top-0 h-full w-[82%] max-w-xs bg-ivory shadow-luxe flex flex-col animate-slideInLeft">
        <div className="flex items-center justify-between p-5 border-b border-sand shrink-0">
          <span className="font-display text-2xl text-ink">Blythe Diva</span>
          <button aria-label="Close" onClick={() => setOpen(false)} className="text-xl text-muted hover:text-rose">✕</button>
        </div>
        <nav className="flex-1 overflow-y-auto p-5 space-y-1">
          <Link href="/shop" onClick={() => setOpen(false)} className="block py-2 font-medium text-ink">All Jewellery</Link>
          {cats.map((c) => (
            <div key={c.slug}>
              <Link href={`/shop/c/${c.slug}`} onClick={() => setOpen(false)} className="block py-2 text-ink/80">{c.name}</Link>
              {c.subcategories && c.subcategories.length > 0 && (
                <div className="ml-3 mb-1 space-y-0.5">
                  {c.subcategories.map((s) => (
                    <Link key={s.slug} href={`/shop/c/${c.slug}?sub=${s.slug}`} onClick={() => setOpen(false)} className="block py-1 text-sm text-muted hover:text-emerald">{s.name}</Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="pt-2 mt-2 border-t border-sand/60">
            <Link href="/shop#new-arrivals" onClick={() => setOpen(false)} className="block py-2 text-ink/80">New Arrivals</Link>
            <Link href="/shop#bestsellers" onClick={() => setOpen(false)} className="block py-2 text-ink/80">Bestsellers</Link>
            <Link href="/reels" onClick={() => setOpen(false)} className="block py-2 text-ink/80">Reels</Link>
            <Link href="/wishlist" onClick={() => setOpen(false)} className="block py-2 text-ink/80">My Wishlist</Link>
            <Link href="/account" onClick={() => setOpen(false)} className="block py-2 text-ink/80">Track my order</Link>
          </div>
        </nav>
      </div>
    </div>
  );

  return (
    <>
      <button aria-label="Menu" onClick={() => setOpen(true)} className="md:hidden p-1.5 -ml-1.5 text-ink"><IconMenu /></button>
      {mounted && open ? createPortal(drawer, document.body) : null}
    </>
  );
}
