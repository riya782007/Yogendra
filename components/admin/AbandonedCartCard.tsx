"use client";
import { useState } from "react";
import Link from "next/link";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";

type Item = { sku?: string; name: string; qty: number; price: number };
type Cart = { id: string; customer_name?: string | null; phone?: string | null; total: number; created_at: string; items: Item[]; channel?: string | null };

const agoText = (d: string) => {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** One abandoned cart — a compact summary that expands to full product + customer detail. */
export function AbandonedCartCard({ cart, imgMap, slugMap }: { cart: Cart; imgMap: Record<string, string>; slugMap: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const items = cart.items ?? [];
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const phone = cart.phone ? String(cart.phone).replace(/\D/g, "") : "";
  const isWholesale = String(cart.channel ?? "").toLowerCase() === "wholesale";
  const waMsg = isWholesale
    ? `Hi ${cart.customer_name || "there"}! You added ${totalQty} piece${totalQty === 1 ? "" : "s"} to your Blythe Diva wholesale cart but didn't place the order. Need help or a better rate? Reply here and we'll sort it out. 🙏`
    : `Hi ${cart.customer_name || "there"}! You left some beautiful pieces in your Blythe Diva bag. Complete your order and enjoy 20% off ✨`;
  const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}` : null;
  const when = new Date(cart.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start justify-between gap-4 text-left">
        <p className="font-medium text-ink">
          <span className="text-muted mr-1 inline-block transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>▸</span>
          {cart.customer_name || "Anonymous visitor"}
          {isWholesale && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-wine/10 text-wine align-middle">WHOLESALE</span>}
          <span className="text-xs text-muted"> · {agoText(cart.created_at)} · {totalQty} item{totalQty === 1 ? "" : "s"}</span>
        </p>
        <div className="text-right shrink-0">
          <p className="font-semibold text-ink">{formatPaise(cart.total)}</p>
          {wa ? <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-emerald nav-link">WhatsApp nudge →</a> : <span className="text-xs text-muted">no contact</span>}
        </div>
      </button>

      {/* Collapsed: mini-catalog of thumbnails */}
      {!open && (
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-6 gap-2 mt-3">
          {items.map((it, idx) => (
            <div key={idx} className="rounded-xl border border-sand overflow-hidden bg-cream/40">
              <div className="aspect-square bg-cream">
                {it.sku && imgMap[it.sku] ? <img src={imgMap[it.sku]} alt={it.name} className="w-full h-full object-cover" /> : <ProductImage name={it.name} />}
              </div>
              <div className="p-1.5">
                {it.sku && <p className="text-[10px] font-mono text-muted truncate">{it.sku}</p>}
                <p className="text-[11px] text-ink leading-tight line-clamp-2">{it.name}</p>
                <p className="text-[11px] text-muted mt-0.5">×{it.qty} · {formatPaise(it.price)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expanded: full customer + per-product detail */}
      {open && (
        <div className="mt-4 space-y-4">
          {/* Customer block */}
          <div className="rounded-xl border border-sand bg-cream/30 p-3 text-sm grid sm:grid-cols-3 gap-2">
            <div><p className="text-[11px] text-muted">Customer</p><p className="text-ink">{cart.customer_name || "Anonymous visitor"}</p></div>
            <div><p className="text-[11px] text-muted">Phone</p>{phone ? <p className="text-ink"><a href={`tel:${phone}`} className="hover:text-emerald">{cart.phone}</a></p> : <p className="text-muted">Not captured</p>}</div>
            <div><p className="text-[11px] text-muted">Abandoned on</p><p className="text-ink">{when}</p></div>
          </div>

          {/* Per-item detail with product links */}
          <div className="space-y-2">
            {items.map((it, idx) => {
              const slug = it.sku ? slugMap[it.sku] : undefined;
              const href = it.sku && slug ? `/shop/${slug}/${it.sku}` : null;
              return (
                <div key={idx} className="flex gap-3 items-center rounded-xl border border-sand p-2">
                  <div className="h-16 w-14 rounded-lg overflow-hidden shrink-0 bg-cream">
                    {it.sku && imgMap[it.sku] ? <img src={imgMap[it.sku]} alt={it.name} className="w-full h-full object-cover" /> : <ProductImage name={it.name} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{it.name}</p>
                    {it.sku && <p className="text-[11px] font-mono text-muted">{it.sku}</p>}
                    <p className="text-xs text-muted mt-0.5">{it.qty} × {formatPaise(it.price)}</p>
                    {href && <Link href={href} target="_blank" className="text-[11px] text-emerald nav-link">View product ↗</Link>}
                  </div>
                  <span className="text-sm font-medium text-ink shrink-0">{formatPaise(it.price * it.qty)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
