"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type Promo = {
  id: string; title: string | null; image_path: string | null; media_type?: string | null;
  headline?: string | null; subtext?: string | null; cta_href?: string | null; cta_label?: string | null;
  discount_code?: string | null; ends_at?: string | null; category?: { slug?: string } | null;
};

/** Countdown to a sale's end — creates urgency like the big storefronts. */
function useCountdown(ends?: string | null) {
  const [left, setLeft] = useState<number>(() => (ends ? new Date(ends).getTime() - Date.now() : 0));
  useEffect(() => {
    if (!ends) return;
    const t = setInterval(() => setLeft(new Date(ends).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [ends]);
  if (!ends || left <= 0) return null;
  const s = Math.floor(left / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return { d, h, m, s: sec };
}

/**
 * Storefront promotional POPUP — the modal that greets visitors with the current offer (like Amazon /
 * Flipkart). Shows once per browser session, respects the schedule, and can carry a countdown + code.
 */
export function PromoPopup({ promo }: { promo: Promo | null }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const cd = useCountdown(promo?.ends_at);

  useEffect(() => {
    setMounted(true);
    if (!promo) return;
    try { if (sessionStorage.getItem(`bd_popup_${promo.id}`)) return; } catch {}
    const t = setTimeout(() => setOpen(true), 1200); // gentle delay so it doesn't feel jarring
    return () => clearTimeout(t);
  }, [promo]);

  if (!promo || !mounted || !open) return null;
  const close = () => { setOpen(false); try { sessionStorage.setItem(`bd_popup_${promo.id}`, "1"); } catch {} };
  const href = promo.cta_href || (promo.category?.slug ? `/shop/c/${promo.category.slug}` : "/shop");
  const isVideo = (promo.media_type ?? "").toLowerCase() === "video";
  const pad = (n: number) => String(n).padStart(2, "0");

  const modal = (
    <div className="fixed inset-0 z-[120] bg-ink/70 backdrop-blur-sm grid place-items-center p-4 animate-fadeIn" onClick={close}>
      <div className="relative bg-ivory rounded-3xl shadow-luxe w-full max-w-md overflow-hidden animate-[pop_.3s_ease]" onClick={(e) => e.stopPropagation()}>
        <button onClick={close} aria-label="Close" className="absolute top-3 right-3 z-10 h-8 w-8 rounded-full bg-white/85 text-ink grid place-items-center hover:bg-white shadow">✕</button>
        {promo.image_path && (
          <div className="w-full">
            {isVideo
              ? <video src={promo.image_path} className="w-full max-h-[52vh] object-cover" autoPlay muted loop playsInline />
              : <img src={promo.image_path} alt={promo.headline ?? promo.title ?? "Offer"} className="w-full max-h-[52vh] object-cover" />}
          </div>
        )}
        <div className="p-5 text-center">
          {promo.headline && <h3 className="font-display text-2xl text-ink">{promo.headline}</h3>}
          {promo.subtext && <p className="text-sm text-muted mt-1">{promo.subtext}</p>}

          {cd && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-ink">
              {[["Days", cd.d], ["Hrs", cd.h], ["Min", cd.m], ["Sec", cd.s]].map(([label, v]) => (
                <div key={label as string} className="bg-ink text-cream rounded-lg px-2.5 py-1 min-w-[42px]">
                  <div className="text-lg font-semibold tabular-nums leading-none">{pad(v as number)}</div>
                  <div className="text-[9px] uppercase tracking-wide text-cream/70">{label}</div>
                </div>
              ))}
            </div>
          )}

          {promo.discount_code && (
            <button
              onClick={() => { try { navigator.clipboard.writeText(promo.discount_code!); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500); }}
              className="mt-3 inline-flex items-center gap-2 rounded-full border-2 border-dashed border-gold bg-gold/10 px-4 py-1.5 text-sm font-semibold text-gold-dark hover:bg-gold/20">
              Code: {promo.discount_code} <span className="text-[11px] font-normal text-muted">{copied ? "copied ✓" : "tap to copy"}</span>
            </button>
          )}

          <Link href={href} onClick={close} className="btn-primary block text-center py-3 text-sm font-medium mt-4">{promo.cta_label || "Shop the offer"}</Link>
          <button onClick={close} className="mt-2 text-xs text-muted hover:text-ink">No thanks</button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
