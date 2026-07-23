"use client";
import { useEffect, useState } from "react";

// Must match the CartProvider's localStorage key + item shape (components/cart/CartContext.tsx).
const KEY = "bd_cart_v1";
type RItem = { sku: string; name: string; price: number; category: string; color?: string; qty: number };

/**
 * Rebuilds the shopper's cart from an abandoned-cart recovery link and sends them to checkout to pay.
 * The owner shares  https://blythediva.com/cart/recover/<cartId>  over WhatsApp; opening it writes the
 * saved items into the same localStorage the cart reads on load, then forwards to /checkout.
 */
export function CartRestore({ items }: { items: RItem[] }) {
  const [err, setErr] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items));
      // Full navigation (not client push) so the CartProvider re-reads localStorage fresh on checkout.
      window.location.replace("/checkout");
    } catch {
      setErr(true);
    }
  }, [items]);

  return (
    <main className="min-h-screen grid place-items-center p-8 text-center bg-cream/40">
      <div>
        <p className="font-display text-2xl text-ink">Loading your cart…</p>
        <p className="text-sm text-muted mt-2">Taking you to checkout to confirm and pay for your order.</p>
        {err && <a href="/checkout" className="inline-block mt-4 text-emerald underline">Continue to checkout →</a>}
      </div>
    </main>
  );
}
