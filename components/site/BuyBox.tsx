"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart/CartContext";
import { useToast } from "@/components/ui/Toast";
import { formatPaise } from "@/lib/pricing";
import { requestNotifyAction } from "@/app/actions/notify";

export type BuyVariant = { sku: string; label: string; image: string | null; price: number; qty: number };

export function BuyBox({ variants = [], waHref, item }: {
  variants?: BuyVariant[];
  waText: string; waHref: string;
  item: { sku: string; name: string; price: number; category: string; qty?: number };
}) {
  const { add } = useCart();
  const { toast } = useToast();
  const router = useRouter();
  const hasVariants = variants.length > 0;
  const [vi, setVi] = useState(0);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  const sel = hasVariants ? variants[Math.min(vi, variants.length - 1)] : null;
  const price = sel ? sel.price : item.price;
  const outOfStock = sel ? sel.qty <= 0 : (item.qty != null && item.qty <= 0);

  // The exact line that goes into the cart for this product/variant + chosen qty.
  const cartLine = () => ({ sku: item.sku, name: item.name, price, category: item.category, color: sel?.label });

  const onAdd = () => {
    if (outOfStock) return;
    // Cart carries the PRODUCT sku (checkout/billing resolves products by sku) plus the
    // chosen variant as its label, so the order records exactly which option was picked.
    add(cartLine(), qty);
    toast(`${item.name}${sel ? ` (${sel.label})` : ""} added to bag`);
    setAdded(true); setTimeout(() => setAdded(false), 1500);
  };

  // "Buy now": drop this single item in the bag and go straight to checkout with the
  // payment method preselected (delivery address is still required there for both flows).
  const buyNow = (method: "online" | "cod") => {
    if (outOfStock) return;
    add(cartLine(), qty);
    router.push(`/checkout?pay=${method}`);
  };

  // Notify Me — capture demand when the (selected) item is out of stock.
  const [nOpen, setNOpen] = useState(false);
  const [nName, setNName] = useState("");
  const [nPhone, setNPhone] = useState("");
  const [nDone, setNDone] = useState(false);
  const [nErr, setNErr] = useState("");
  const [nBusy, setNBusy] = useState(false);
  async function submitNotify() {
    setNBusy(true); setNErr("");
    const fd = new FormData();
    fd.set("sku", sel?.sku || item.sku); fd.set("name", nName); fd.set("phone", nPhone);
    const res = await requestNotifyAction(fd);
    setNBusy(false);
    if (res.ok) setNDone(true); else setNErr(res.error ?? "Couldn't save — try again.");
  }

  return (
    <div className="mt-6">
      {hasVariants && (
        <div className="mb-5">
          <p className="text-sm font-medium text-ink mb-2">Option: <span className="text-muted font-normal">{sel?.label}</span> · <span className="text-ink">{formatPaise(price)}</span></p>
          <div className="flex flex-wrap gap-2.5">
            {variants.map((v, i) => {
              const on = i === vi;
              return (
                <button key={v.sku} onClick={() => { setVi(i); }} title={v.label}
                  className={`relative w-16 rounded-xl border p-1 text-center transition-all ${on ? "border-emerald ring-2 ring-emerald/30" : "border-sand hover:border-gold"} ${v.qty <= 0 ? "opacity-50" : ""}`}>
                  <div className="aspect-square rounded-lg overflow-hidden bg-cream grid place-items-center">
                    {v.image ? <img src={v.image} alt={v.label} className="w-full h-full object-cover" /> : <span className="text-[10px] text-muted px-1 leading-tight">{v.label}</span>}
                  </div>
                  <span className="block text-[10px] text-ink/80 mt-0.5 truncate">{v.label}</span>
                  {v.qty <= 0 && <span className="absolute inset-x-0 top-1 text-[8px] uppercase text-rose">Out</span>}
                </button>
              );
            })}
          </div>
          {sel && <p className="text-[11px] text-muted mt-1.5">{sel.qty > 0 ? `${sel.qty} in stock · SKU ${sel.sku}` : "This option is out of stock"}</p>}
        </div>
      )}
      <div className="flex items-center gap-3 mb-5">
        <span className="text-sm font-medium text-ink">Qty</span>
        <div className="inline-flex items-center rounded-full border border-sand overflow-hidden">
          <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="px-3 py-1.5 hover:bg-cream transition-colors">−</button>
          <span className="px-4 text-sm">{qty}</span>
          <button onClick={() => setQty((q) => q + 1)} className="px-3 py-1.5 hover:bg-cream transition-colors">+</button>
        </div>
      </div>
      {/* Primary: buy now — straight to a one-step checkout with the method preselected */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button onClick={() => buyNow("online")} disabled={outOfStock} className="btn-primary py-3.5 text-sm font-semibold disabled:opacity-50">
          {outOfStock ? "Out of stock" : "Buy Now · Pay Online"}
        </button>
        <button onClick={() => buyNow("cod")} disabled={outOfStock} className="py-3.5 rounded-full border-2 border-emerald text-emerald text-sm font-semibold transition-colors hover:bg-emerald-mist disabled:opacity-50">
          Cash on Delivery
        </button>
      </div>
      {/* Secondary: keep building a bag, or order over WhatsApp */}
      <div className="flex gap-3 mt-3">
        <button onClick={onAdd} disabled={outOfStock} className="flex-1 py-3 rounded-full border border-sand text-ink text-sm font-medium transition-colors hover:border-gold disabled:opacity-50">
          {added ? "✓ Added to cart" : "Add to cart"}
        </button>
        <a href={waHref} target="_blank" rel="noreferrer" className="px-5 py-3 rounded-full bg-[#25D366] text-white text-sm font-medium transition-transform hover:-translate-y-0.5 active:scale-95">WhatsApp</a>
      </div>
      {outOfStock && (
        <div className="mt-3 rounded-2xl border border-gold/40 bg-gold/5 p-4">
          {nDone ? (
            <p className="text-sm text-emerald-dark">✓ Done — we&apos;ll text you on {nPhone} the moment it&apos;s back in stock.</p>
          ) : !nOpen ? (
            <button onClick={() => setNOpen(true)} className="w-full py-3 rounded-full bg-ink text-white text-sm font-medium">🔔 Notify me when it&apos;s back</button>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Get a text when it&apos;s restocked</p>
              <input value={nName} onChange={(e) => setNName(e.target.value)} placeholder="Your name (optional)" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm outline-none focus:border-emerald" />
              <input value={nPhone} onChange={(e) => setNPhone(e.target.value)} placeholder="Phone number" inputMode="tel" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm outline-none focus:border-emerald" />
              {nErr && <p className="text-xs text-rose">{nErr}</p>}
              <button onClick={submitNotify} disabled={nBusy} className="w-full py-2.5 rounded-full bg-emerald text-white text-sm font-medium disabled:opacity-50">{nBusy ? "Saving…" : "Notify me"}</button>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1"><span>✓ COD available</span><span>✓ Free shipping over ₹999</span><span>✓ 7-day returns</span></p>
    </div>
  );
}
