"use client";
import Link from "next/link";
import { useWishlist } from "@/components/wishlist/WishlistContext";
import { useCart } from "@/components/cart/CartContext";
import { useToast } from "@/components/ui/Toast";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { Back } from "@/components/site/Back";

export default function Wishlist() {
  const { items, remove } = useWishlist();
  const { add } = useCart();
  const { toast } = useToast();
  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <div className="mb-4"><Back label="Continue shopping" /></div>
      <h1 className="font-display text-4xl text-ink mb-1">Your Wishlist</h1>
      <p className="text-muted mb-6">{items.length} saved {items.length === 1 ? "piece" : "pieces"}</p>
      {items.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted mb-5">Nothing saved yet. Tap the ♡ on any design to keep it here.</p>
          <Link href="/shop" className="btn-primary inline-block px-7 py-3 text-sm font-medium">Discover jewellery</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {items.map((i) => (
            <div key={i.sku} className="rounded-2xl bg-white shadow-card overflow-hidden">
              <Link href={`/shop/${i.categorySlug}/${i.sku}`} className="block aspect-[3/4]"><ProductImage name={i.name} /></Link>
              <div className="p-3">
                <p className="text-[10px] uppercase tracking-wide text-gold-dark">{i.category}</p>
                <h3 className="text-sm font-medium text-ink line-clamp-1">{i.name}</h3>
                <p className="font-semibold text-ink mt-1">{formatPaise(i.price)}</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => { add({ sku: i.sku, name: i.name, price: i.price, category: i.categorySlug }, 1); toast(`${i.name} added to bag`); }} className="btn-gold flex-1 text-xs py-2 font-medium">Add to bag</button>
                  <button onClick={() => { remove(i.sku); toast("Removed from wishlist", "info"); }} className="px-2 text-muted hover:text-rose">✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
