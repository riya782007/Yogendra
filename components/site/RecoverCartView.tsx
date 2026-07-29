"use client";
import { useState } from "react";
import { ProductImage } from "@/components/Placeholder";
import { wholesaleShippingPaise, retailShippingPaise } from "@/lib/wholesaleShipping";

const KEY = "bd_cart_v1"; // must match CartProvider (components/cart/CartContext.tsx)
const TRADE_RECOVER_KEY = "bd_trade_recover"; // read by WholesaleCatalog on mount to restore a dealer cart
type RItem = { sku: string; name: string; price: number; category?: string; color?: string; qty: number; image?: string | null };

const inr = (paise: number) => "₹" + (paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * Visual recovery view for an abandoned cart. Opening the WhatsApp link SHOWS the exact pieces — photo,
 * name, colour, qty and price — then restores the cart in the RIGHT flow: a retail cart goes to the
 * retail checkout (₹80 flat shipping); a WHOLESALE cart goes to the /trade portal where the owner's
 * fixed shipping SLABS apply (never the retail flat rate — that was charging a dealer's ₹3,400 order
 * only ₹100 courier). Shipping shown here matches exactly what the next screen will charge.
 */
export function RecoverCartView({ items, channel = "retail" }: { items: RItem[]; channel?: "retail" | "wholesale" }) {
  const [going, setGoing] = useState(false);
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  const isWholesale = channel === "wholesale";
  // Shipping mirrors the destination checkout exactly. Wholesale uses the slab helper (single source of
  // truth shared with the /trade portal and the server order action); >₹30,000 is quoted separately.
  const ship = isWholesale ? wholesaleShippingPaise(subtotal) : retailShippingPaise(subtotal);
  const shipQuotedSeparately = isWholesale && subtotal > 3000000;
  const total = subtotal + ship;

  function proceed() {
    setGoing(true);
    try {
      if (isWholesale) {
        // Hand the cart to the wholesale portal (it reads this key on mount) and land the dealer on the
        // review step, where slab shipping is applied and a WHOLESALE order is placed.
        localStorage.setItem(TRADE_RECOVER_KEY, JSON.stringify(items.map((i) => ({ sku: i.sku, qty: i.qty }))));
        window.location.assign("/trade");
        return;
      }
      localStorage.setItem(KEY, JSON.stringify(items.map((i) => ({ sku: i.sku, name: i.name, price: i.price, category: i.category ?? "", color: i.color, qty: i.qty }))));
      window.location.assign("/checkout");
    } catch {
      window.location.assign(isWholesale ? "/trade" : "/checkout");
    }
  }

  return (
    <main className="min-h-screen bg-cream/40 py-8 px-4">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-6">
          <p className="text-gold-dark tracking-[0.2em] uppercase text-[11px]">Blythe Diva</p>
          <h1 className="font-display text-3xl text-ink mt-1">Your bag is waiting ✨</h1>
          <p className="text-sm text-muted mt-1">{items.reduce((n, i) => n + i.qty, 0)} piece(s) — review and complete your order below.</p>
        </div>

        <div className="bg-white rounded-2xl shadow-card overflow-hidden divide-y divide-sand/60">
          {items.map((i, idx) => (
            <div key={i.sku + idx} className="flex items-center gap-3 p-3">
              <div className="h-16 w-16 shrink-0 rounded-xl overflow-hidden bg-cream">
                <ProductImage src={i.image ?? null} name={i.name} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink leading-tight line-clamp-2">{i.name}</p>
                <p className="text-xs text-muted mt-0.5">{i.color ? `${i.color} · ` : ""}Qty {i.qty}</p>
              </div>
              <p className="text-sm font-semibold text-ink shrink-0">{inr(i.price * i.qty)}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-card mt-4 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-sm"><span className="text-muted">Subtotal</span><span className="text-ink">{inr(subtotal)}</span></div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted">Shipping</span>
            {shipQuotedSeparately
              ? <span className="text-[11px] text-gold-dark">quoted separately (order above ₹30,000)</span>
              : <span className="text-ink">{inr(ship)}</span>}
          </div>
          <div className="flex items-center justify-between border-t border-sand/60 pt-1.5">
            <span className="text-sm text-muted">Total{shipQuotedSeparately ? " (before shipping)" : ""}</span>
            <span className="text-xl font-semibold text-ink">{inr(total)}</span>
          </div>
        </div>

        <button onClick={proceed} disabled={going}
          className="btn-primary w-full mt-5 py-3.5 text-sm font-semibold disabled:opacity-60">
          {going ? (isWholesale ? "Taking you to your order…" : "Taking you to checkout…") : "Complete your order & pay →"}
        </button>
        {!isWholesale && <p className="text-center text-sm text-emerald-dark font-medium mt-3">🎁 Pay online &amp; get a FREE mystery gift with your order!</p>}
        <p className="text-[11px] text-muted text-center mt-2">
          {isWholesale
            ? "Wholesale shipping as per slab · Cash on Delivery available · Anti-tarnish premium finish"
            : "₹80 flat shipping · Cash on Delivery available · Anti-tarnish premium finish"}
        </p>
      </div>
    </main>
  );
}
