"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type WishItem = { sku: string; name: string; category: string; categorySlug: string; price: number };
type Ctx = { items: WishItem[]; count: number; has: (sku: string) => boolean; toggle: (i: WishItem) => boolean; remove: (sku: string) => void };
const C = createContext<Ctx | null>(null);
const KEY = "bd_wishlist_v1";

export function WishlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<WishItem[]>([]);
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) setItems(JSON.parse(s)); } catch {} }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);
  const has = (sku: string) => items.some((i) => i.sku === sku);
  const toggle = (i: WishItem) => { let added = false; setItems((p) => { if (p.some((x) => x.sku === i.sku)) return p.filter((x) => x.sku !== i.sku); added = true; return [...p, i]; }); return !has(i.sku); };
  const remove = (sku: string) => setItems((p) => p.filter((x) => x.sku !== sku));
  const count = useMemo(() => items.length, [items]);
  return <C.Provider value={{ items, count, has, toggle, remove }}>{children}</C.Provider>;
}
export function useWishlist() { return useContext(C) ?? { items: [], count: 0, has: () => false, toggle: () => false, remove: () => {} }; }
