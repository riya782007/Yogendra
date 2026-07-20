"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { placeWholesaleOrderFromCartAction } from "@/app/actions/wholesale";
import { deleteAbandonedCartAction } from "@/app/actions/abandoned";

type Item = { sku?: string; name: string; qty: number; price: number };
type Cart = { id: string; session_id?: string | null; customer_name?: string | null; phone?: string | null; total: number; created_at: string; items: Item[]; channel?: string | null; reached_checkout?: boolean | null };

const agoText = (d: string) => {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** One abandoned cart — a compact summary that expands to full product + customer detail. */
export function AbandonedCartCard({ cart, imgMap, slugMap }: { cart: Cart; imgMap: Record<string, string>; slugMap: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [confirmPlace, setConfirmPlace] = useState(false);
  const [placeMsg, setPlaceMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [gone, setGone] = useState(false);
  const items = cart.items ?? [];

  async function remove() {
    setDeleting(true);
    const r = await deleteAbandonedCartAction(cart.id);
    setDeleting(false); setConfirmDel(false);
    if (r.ok) { setGone(true); router.refresh(); }
    else setPlaceMsg({ text: r.error ?? "Couldn't delete.", ok: false });
  }
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const phone = cart.phone ? String(cart.phone).replace(/\D/g, "") : "";

  async function placeOrder(markPaid: boolean) {
    if (!cart.session_id) { setPlaceMsg({ text: "Missing cart id.", ok: false }); return; }
    setPlacing(true); setPlaceMsg(null);
    const r = await placeWholesaleOrderFromCartAction({ sessionId: cart.session_id, markPaid });
    setPlacing(false); setConfirmPlace(false);
    if (!r.ok) { setPlaceMsg({ text: r.error ?? "Couldn't place the order.", ok: false }); return; }
    setPlaceMsg({ text: `Order placed ✓${markPaid ? " (marked paid)" : ""} — now in your pipeline.`, ok: true });
    router.refresh();
  }
  const isWholesale = String(cart.channel ?? "").toLowerCase() === "wholesale";
  const waMsg = isWholesale
    ? `Hi ${cart.customer_name || "there"}! You added ${totalQty} piece${totalQty === 1 ? "" : "s"} to your Blythe Diva wholesale cart but didn't place the order. Need help or a better rate? Reply here and we'll sort it out. 🙏`
    : `Hi ${cart.customer_name || "there"}! You left some beautiful pieces in your Blythe Diva bag. Complete your order and enjoy 20% off ✨`;
  const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}` : null;
  const when = new Date(cart.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

  if (gone) return null;

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-start justify-between gap-4 text-left">
        <p className="font-medium text-ink">
          <span className="text-muted mr-1 inline-block transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }}>▸</span>
          {cart.customer_name || "Anonymous visitor"}
          {isWholesale && <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-wine/10 text-wine align-middle">WHOLESALE</span>}
          {cart.reached_checkout && <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald text-white align-middle">REACHED PAYMENT</span>}
          <span className="text-xs text-muted"> · {agoText(cart.created_at)} · {totalQty} item{totalQty === 1 ? "" : "s"}</span>
        </p>
        <div className="text-right shrink-0 flex items-start gap-2">
          <div>
            <p className="font-semibold text-ink">{formatPaise(cart.total)}</p>
            {wa ? <a href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-emerald nav-link">WhatsApp nudge →</a> : <span className="text-xs text-muted">no contact</span>}
          </div>
          {/* Delete — for irrelevant carts (anonymous, tiny, junk). Confirm inline so it's never a mis-tap. */}
          {confirmDel ? (
            <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button onClick={remove} disabled={deleting} className="text-[11px] px-2 py-0.5 rounded-full bg-rose text-white disabled:opacity-50">{deleting ? "…" : "Delete"}</button>
              <button onClick={() => setConfirmDel(false)} className="text-[11px] px-2 py-0.5 rounded-full border border-sand text-muted">No</button>
            </span>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); setConfirmDel(true); }} title="Remove this cart" className="text-muted hover:text-rose text-sm leading-none px-1">✕</button>
          )}
        </div>
      </button>

      {/* Wholesale: after confirming with the dealer (e.g. on a call), place the order in one click —
          it converts this captured cart into a real wholesale order in the pipeline. */}
      {isWholesale && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-sand/50 pt-2">
          {confirmPlace ? (
            <>
              <span className="text-[11px] text-muted">Place this order for the dealer?</span>
              <button onClick={() => placeOrder(false)} disabled={placing} className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs font-medium disabled:opacity-50">{placing ? "Placing…" : "Place (unpaid)"}</button>
              <button onClick={() => placeOrder(true)} disabled={placing} className="px-3 py-1.5 rounded-full bg-ink text-white text-xs font-medium disabled:opacity-50">Place &amp; mark paid</button>
              <button onClick={() => setConfirmPlace(false)} className="px-3 py-1.5 rounded-full border border-sand text-muted text-xs">Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmPlace(true)} className="px-3 py-1.5 rounded-full border border-emerald text-emerald-dark text-xs font-medium hover:bg-emerald-mist/40">✓ Place this order for the dealer</button>
          )}
          {placeMsg && <span className={`text-[11px] ${placeMsg.ok ? "text-emerald-dark" : "text-rose"}`}>{placeMsg.text}</span>}
        </div>
      )}

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
