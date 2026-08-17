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
  const [contactTick, setContactTick] = useState(0);
  useEffect(() => { try { const s = localStorage.getItem(KEY); if (s) setItems(JSON.parse(s)); } catch {} setLoaded(true); }, []);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);
  useEffect(() => {
    const bump = () => setContactTick((n) => n + 1);
    window.addEventListener("bd-contact", bump);
    window.addEventListener("storage", bump);
    return () => { window.removeEventListener("bd-contact", bump); window.removeEventListener("storage", bump); };
  }, []);

  // Record the cart server-side (debounced) so unfinished carts show on the admin Abandoned Carts
  // page. Fire-and-forget — analytics must never break the storefront.
  useEffect(() => {
    if (!loaded) return;
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const t = setTimeout(() => {
      try {
        // If the shopper has given a name + phone (exit-intent popup or checkout form), attach it so the
        // cart surfaces on the owner's Abandoned Carts page WITH a contact he can follow up on.
        let contact: { name?: string; phone?: string; city?: string } = {};
        try { contact = JSON.parse(localStorage.getItem("bd_retail_contact") || "{}") || {}; } catch {}
        // Only record a cart we can actually ACT on. A cart with no captured phone would just show as an
        // un-contactable "Anonymous visitor" and clutter the owner's list (owner: "Anonymous kyun aa raha
        // hai"). The cart gets recorded the moment the shopper gives a phone (popup or checkout form).
        const phone = String(contact.phone || "").replace(/\D/g, "");
        if (phone.length < 7) return;
        fetch("/api/cart/track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, price: i.price, color: i.color })), total,
            name: contact.name || undefined, phone: contact.phone || undefined, city: contact.city || undefined,
          }),
          keepalive: true,
        }).catch(() => {});
      } catch {}
    }, 2500);
    return () => clearTimeout(t);
  }, [items, loaded, contactTick]);

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
