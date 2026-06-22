"use client";
import Link from "next/link";
import { useState } from "react";
import { IconMenu } from "./Icons";

export function MobileMenu({ categories }: { categories: { name: string; slug: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-label="Menu" onClick={() => setOpen(true)} className="md:hidden p-1.5 -ml-1.5 text-ink"><IconMenu /></button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72 bg-ivory p-6 animate-[fadeIn_.2s_ease] shadow-luxe">
            <div className="flex items-center justify-between mb-6">
              <span className="font-display text-2xl text-ink">Blythe Diva</span>
              <button aria-label="Close" onClick={() => setOpen(false)} className="text-xl">✕</button>
            </div>
            <nav className="space-y-1">
              <Link href="/shop" onClick={() => setOpen(false)} className="block py-2 text-ink">All Jewellery</Link>
              {categories.map((c) => (
                <Link key={c.slug} href={`/shop/c/${c.slug}`} onClick={() => setOpen(false)} className="block py-2 text-ink/80">{c.name}</Link>
              ))}
              <Link href="/reels" onClick={() => setOpen(false)} className="block py-2 text-ink/80">Reels</Link>
              <Link href="/wishlist" onClick={() => setOpen(false)} className="block py-2 text-ink/80">My Wishlist</Link>
              <Link href="/account" onClick={() => setOpen(false)} className="block py-2 text-ink/80">Track my order</Link>
              <Link href="/wholesale" onClick={() => setOpen(false)} className="block py-2 text-emerald font-medium">Wholesale</Link>
              <Link href="/admin/dashboard" onClick={() => setOpen(false)} className="block py-2 text-muted">Owner Console</Link>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
