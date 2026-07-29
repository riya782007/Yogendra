"use client";
import { useEffect, useRef, useState } from "react";
import { useCart } from "@/components/cart/CartContext";

const K_DONE = "bd_retail_lead_done";
const K_SNOOZE = "bd_retail_lead_snooze_until";

/**
 * Soft exit-intent capture for the RETAIL shop (owner: "ask at exit/checkout, don't wall off the shop").
 *
 * Deliberately NOT a blocking gate: shoppers browse freely. It only appears when a guest is about to
 * LEAVE with items already in the cart — the highest-value moment to grab a name + phone so the owner
 * can follow up on WhatsApp. It's fully dismissible (× or backdrop), and dismissing snoozes it (a day
 * first, then a week) so it never nags. Once submitted it never shows again, and the contact is pushed
 * onto the live cart row so the abandoned cart surfaces WITH a name + phone.
 */
export function RetailLeadPopup() {
  const { count } = useCart();
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const fired = useRef(false);
  const countRef = useRef(count);
  countRef.current = count;

  useEffect(() => {
    try {
      if (localStorage.getItem(K_DONE) === "1") return;
      const until = Number(localStorage.getItem(K_SNOOZE) || 0);
      if (until && Date.now() < until) return;
    } catch { /* private mode — behave normally */ }

    const trigger = () => {
      if (fired.current) return;
      if (countRef.current < 1) return; // only worth asking once they actually have something in the cart
      const el = document.activeElement?.tagName?.toLowerCase();
      if (el === "input" || el === "textarea" || el === "select") return; // never interrupt mid-typing
      fired.current = true;
      setShow(true);
    };

    // Desktop exit-intent: cursor leaves through the top of the window (heading for the tab/close bar).
    const onExit = (e: MouseEvent) => { if (e.clientY <= 0 && !e.relatedTarget) trigger(); };
    document.addEventListener("mouseout", onExit);

    // Touch fallback: a full cart left idle for 45s (they likely switched away) — catch them once.
    // Mobile has no cursor exit-intent, so this + the visibility trigger below are what catch phone users.
    let idle: ReturnType<typeof setTimeout>;
    const resetIdle = () => { clearTimeout(idle); idle = setTimeout(trigger, 45000); };
    window.addEventListener("touchstart", resetIdle, { passive: true });
    window.addEventListener("scroll", resetIdle, { passive: true });
    resetIdle();

    // Mobile "leaving" signal: the shopper backgrounds the tab (switches app / locks phone) and then
    // returns — ask the moment they come back, while the cart is still on their mind.
    const onVisible = () => { if (document.visibilityState === "visible") trigger(); };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      document.removeEventListener("mouseout", onExit);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("touchstart", resetIdle);
      window.removeEventListener("scroll", resetIdle);
      clearTimeout(idle);
    };
  }, []);

  function dismiss() {
    setShow(false);
    try {
      const prior = localStorage.getItem(K_SNOOZE);
      const days = prior ? 7 : 1; // first dismissal: a day; again: a week — don't nag.
      localStorage.setItem(K_SNOOZE, String(Date.now() + days * 864e5));
    } catch { /* ignore */ }
  }

  async function submit() {
    if (!name.trim() || phone.replace(/\D/g, "").length < 7) { setErr("Please add your name and phone number."); return; }
    setErr(""); setBusy(true);
    try {
      localStorage.setItem("bd_retail_contact", JSON.stringify({ name: name.trim(), phone: phone.trim() }));
      localStorage.setItem(K_DONE, "1");
    } catch { /* ignore */ }
    // Push the contact onto the live cart row immediately so it surfaces (with name + phone) on the
    // owner's Abandoned Carts page even if they leave right now.
    try {
      const items = JSON.parse(localStorage.getItem("bd_cart_v1") || "[]");
      const list = Array.isArray(items) ? items : [];
      const total = list.reduce((s: number, i: any) => s + (Number(i?.price) || 0) * (Number(i?.qty) || 0), 0);
      await fetch("/api/cart/track", {
        method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
        body: JSON.stringify({ items: list.map((i: any) => ({ sku: i?.sku, name: i?.name, qty: i?.qty, price: i?.price })), total, name: name.trim(), phone: phone.trim() }),
      });
    } catch { /* never break over analytics */ }
    setBusy(false); setDone(true);
    setTimeout(() => setShow(false), 2000);
  }

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-ink/50 backdrop-blur-sm grid place-items-center p-4" onClick={dismiss}>
      <div className="rounded-2xl bg-white shadow-luxe border border-gold/40 p-5 w-full max-w-[360px] relative animate-fadeIn" onClick={(e) => e.stopPropagation()}>
        <button onClick={dismiss} aria-label="Close" className="absolute right-3 top-2 text-xl leading-none text-muted hover:text-ink">×</button>
        {done ? (
          <div className="py-2 text-center">
            <p className="font-medium text-emerald-dark">Thank you 🙏</p>
            <p className="text-sm text-muted mt-1">We&apos;ll keep your pieces aside and reach out shortly.</p>
          </div>
        ) : (
          <>
            <p className="font-display text-xl text-ink leading-tight pr-6">Leaving so soon?</p>
            <p className="text-xs text-muted mt-1">Leave your name &amp; number — we&apos;ll hold your cart and help you finish the order.</p>
            <div className="mt-3 space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
                className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-gold" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone (WhatsApp)"
                className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-gold" />
            </div>
            {err && <p className="text-xs text-rose mt-1.5">{err}</p>}
            <button onClick={submit} disabled={busy} className="w-full mt-3 px-3 py-2.5 rounded-full bg-ink text-cream text-sm font-medium disabled:opacity-50">
              {busy ? "Saving…" : "Hold my cart"}
            </button>
            <p className="text-[10px] text-muted mt-2 text-center">No spam — just a quick follow-up about your order.</p>
          </>
        )}
      </div>
    </div>
  );
}
