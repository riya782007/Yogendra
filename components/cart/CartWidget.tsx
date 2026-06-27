"use client";
import Link from "next/link";
import { useCart } from "./CartContext";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { IconBag } from "@/components/site/Icons";

export function CartWidget() {
  const { items, count, total, open, setOpen, remove, setQty } = useCart();
  return (
    <>
      <button aria-label="Shopping bag" title="Bag" onClick={() => setOpen(true)} className="relative p-2 rounded-full text-ink hover:bg-cream hover:text-emerald transition-colors">
        <IconBag />
        {count > 0 && <span className="absolute -top-0.5 -right-0.5 bg-gold text-ink text-[10px] h-4 min-w-4 px-1 rounded-full grid place-items-center">{count}</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-ink/40 animate-fadeIn" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[88%] max-w-md bg-ivory shadow-luxe flex flex-col animate-[fadeIn_.2s_ease]">
            <div className="flex items-center justify-between p-5 border-b border-sand">
              <p className="font-display text-2xl text-ink">Your Bag ({count})</p>
              <button aria-label="Close" onClick={() => setOpen(false)} className="text-xl hover:text-rose transition-colors">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {items.length === 0 && <p className="text-muted text-sm text-center mt-10">Your bag is empty. Discover something beautiful ✦</p>}
              {items.map((i) => (
                <div key={i.sku + (i.color ?? "")} className="flex gap-3 items-center">
                  <div className="h-16 w-14 rounded-lg overflow-hidden shrink-0"><ProductImage name={i.name} /></div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{i.name}</p>
                    {i.color && <p className="text-xs text-muted">{i.color}</p>}
                    <div className="flex items-center gap-2 mt-1">
                      <div className="inline-flex items-center rounded-full border border-sand text-sm">
                        <button onClick={() => setQty(i.sku, i.color, i.qty - 1)} className="px-2">−</button>
                        <span className="px-1.5">{i.qty}</span>
                        <button onClick={() => setQty(i.sku, i.color, i.qty + 1)} className="px-2">+</button>
                      </div>
                      <button onClick={() => remove(i.sku, i.color)} className="text-xs text-muted hover:text-rose">Remove</button>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-ink">{formatPaise(i.price * i.qty)}</span>
                </div>
              ))}
            </div>
            {items.length > 0 && (
              <div className="p-5 border-t border-sand">
                <div className="flex justify-between text-sm mb-1"><span className="text-muted">Subtotal</span><span className="font-semibold text-ink">{formatPaise(total)}</span></div>
                <p className="text-xs text-muted mb-3">Shipping &amp; COD calculated at checkout · Free over ₹999</p>
                <Link href="/checkout" onClick={() => setOpen(false)} className="btn-primary block text-center py-3 text-sm font-medium">Checkout</Link>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
