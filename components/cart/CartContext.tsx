"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type CartItem = { sku: string; name: string; price: number; category: string; color?: string; qty: number };
type Ctx = {
  items: CartItem[]; count: number; total: number; open: boolean;
  setOpen: (o: boolean) => void;
  add: (i: Omit<CartItem, "qty">, qty?: number) => void;
  remove: (sku: string, color?: string) => void;
  setQty: (sku: string, color: string | undefined, qty: number) => void;
  clear: () => void;
};
const CartCtx = createContext<Ctx | null>(null);
const KEY = "bd_cart_v1";
const same = (a: CartItem, sku: string, color?: string) => a.sku === sku && (a.color ?? "") === (color ?? "");

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) setItems(JSON.parse(s)); } catch {} setLoaded(true); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);

  // Record the cart server-side (debounced) so unfinished carts show on the admin Abandoned Carts
  // page. Fire-and-forget — analytics must never break the storefront.
  useEffect(() => {
    if (!loaded) return;
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const t = setTimeout(() => {
      try {
        fetch("/api/cart/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, price: i.price })), total }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }, 2500);
    return () => clearTimeout(t);
  }, [items, loaded]);

  const add: Ctx["add"] = (i, qty = 1) => {
    setItems((prev) => {
      const ex = prev.find((p) => same(p, i.sku, i.color));
      if (ex) return prev.map((p) => (same(p, i.sku, i.color) ? { ...p, qty: p.qty + qty } : p));
      return [...prev, { ...i, qty }];
    });
  };
  const remove: Ctx["remove"] = (sku, color) => setItems((p) => p.filter((x) => !same(x, sku, color)));
  const setQty: Ctx["setQty"] = (sku, color, qty) => setItems((p) => p.map((x) => (same(x, sku, color) ? { ...x, qty: Math.max(1, qty) } : x)));
  const clear = () => setItems([]);

  const count = useMemo(() => items.reduce((s, i) => s + i.qty, 0), [items]);
  const total = useMemo(() => items.reduce((s, i) => s + i.price * i.qty, 0), [items]);
  return <CartCtx.Provider value={{ items, count, total, open, setOpen, add, remove, setQty, clear }}>{children}</CartCtx.Provider>;
}
export function useCart() { const c = useContext(CartCtx); if (!c) throw new Error("useCart outside provider"); return c; }
