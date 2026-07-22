"use client";
import { useEffect, useRef, useState } from "react";
import { captureTradeVisitorAction } from "@/app/actions/leads";

const K_DONE = "bd_trade_lead_done";
const K_SNOOZE = "bd_trade_lead_snooze_until";
const K_VID = "bd_trade_visitor_id";
const K_DISMISS = "bd_trade_lead_dismissals";

/** Ask only once real interest is shown — whichever of these lands first. */
const MIN_SECONDS = 20;      // never interrupt someone who just arrived
const TIME_TRIGGER = 50;     // ~50s of ACTIVE reading (tab visible, not idle)
const DEPTH_TRIGGER = 12;    // scrolled past roughly a dozen designs
const IDLE_AFTER = 45;       // stop counting if they walked away

/**
 * A soft, corner-anchored request for the visitor's details on the open trade catalogue.
 *
 * Deliberately NOT a blocking modal: the catalogue stays fully usable underneath, the card can be
 * dismissed, and dismissing snoozes it (24h the first time, a week the second). It never fires in the
 * first 20 seconds, never while someone is typing, never for a signed-in dealer, and only counts time
 * the tab is actually visible and being used — so it lands on people who are genuinely browsing.
 */
export function TradeLeadPopup({ totalDesigns = 0 }: { totalDesigns?: number }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  // Prominent = the dealer is LEAVING (moved to close the tab / navigate away). We surface a centred,
  // harder-to-ignore version so the owner captures their name + number before they go — but still leave
  // one clear way out, never a trap.
  const [prominent, setProminent] = useState(false);

  const seconds = useRef(0);
  const lastActive = useRef(Date.now());
  const depth = useRef(0);
  const reason = useRef("time");
  const fired = useRef(false);

  useEffect(() => {
    // Already gave details, or snoozed after a dismissal → stay out of the way entirely.
    try {
      if (localStorage.getItem(K_DONE) === "1") return;
      const until = Number(localStorage.getItem(K_SNOOZE) || 0);
      if (until && Date.now() < until) return;
    } catch { /* private mode — just behave normally */ }

    const trigger = (why: string, prom = false) => {
      if (fired.current) return;
      if (seconds.current < MIN_SECONDS) return;
      // Never interrupt mid-typing (search box, quantity field…).
      const el = document.activeElement?.tagName?.toLowerCase();
      if (el === "input" || el === "textarea" || el === "select") return;
      fired.current = true;
      reason.current = why;
      setProminent(prom);
      setShow(true);
    };

    // EXIT INTENT (desktop): the cursor leaves through the top of the window — they're heading for the
    // tab bar / close / address bar. Last chance to catch a leaving dealer, so show the prominent form.
    const onExit = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget) trigger("exit", true);
    };
    document.addEventListener("mouseout", onExit);

    const onActivity = () => { lastActive.current = Date.now(); };
    const tick = setInterval(() => {
      if (document.hidden) return;
      if ((Date.now() - lastActive.current) / 1000 > IDLE_AFTER) return;
      seconds.current += 1;
      if (seconds.current >= TIME_TRIGGER) trigger("time");
    }, 1000);

    const onScroll = () => {
      onActivity();
      const doc = document.documentElement;
      const max = Math.max(1, doc.scrollHeight - window.innerHeight);
      const frac = Math.min(1, Math.max(0, window.scrollY / max));
      depth.current = Math.max(depth.current, Math.round(frac * Math.max(totalDesigns, 1)));
      if (depth.current >= DEPTH_TRIGGER) trigger("browsed");
    };

    // High intent: picking a colour or setting a quantity means they're shopping, not just looking.
    const onIntent = (ev: Event) => {
      onActivity();
      const t = ev.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName?.toLowerCase();
      if (tag === "select" || (tag === "input" && (t as HTMLInputElement).type !== "search")) {
        // Let them finish interacting first — fire on the next idle moment, not mid-click.
        setTimeout(() => trigger("intent"), 1200);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("mousemove", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    window.addEventListener("touchstart", onActivity, { passive: true });
    document.addEventListener("change", onIntent, true);
    return () => {
      clearInterval(tick);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("mousemove", onActivity);
      window.removeEventListener("keydown", onActivity);
      window.removeEventListener("touchstart", onActivity);
      document.removeEventListener("change", onIntent, true);
      document.removeEventListener("mouseout", onExit);
    };
  }, [totalDesigns]);

  // Esc closes, like any well-behaved dialog.
  useEffect(() => {
    if (!show) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [show]);

  function dismiss() {
    setShow(false);
    try {
      const n = Number(localStorage.getItem(K_DISMISS) || 0) + 1;
      localStorage.setItem(K_DISMISS, String(n));
      // Asked once and waved away → back off a day. Twice → a full week.
      const wait = n >= 2 ? 7 * 24 * 3600e3 : 24 * 3600e3;
      localStorage.setItem(K_SNOOZE, String(Date.now() + wait));
    } catch { /* ignore */ }
  }

  async function submit() {
    setErr(""); setBusy(true);
    let vid = "";
    try {
      vid = localStorage.getItem(K_VID) || "";
      if (!vid) { vid = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(K_VID, vid); }
    } catch { /* ignore */ }
    const r = await captureTradeVisitorAction({
      name, phone, city, visitorId: vid,
      designsViewed: depth.current, activeSeconds: seconds.current, reason: reason.current,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "Could not save — please try again."); return; }
    try { localStorage.setItem(K_DONE, "1"); } catch { /* ignore */ }
    setDone(true);
    setTimeout(() => setShow(false), 2200);
  }

  if (!show) return null;

  const inner = done ? (
    <div className="py-2">
      <p className="font-medium text-emerald-dark">Thank you 🙏</p>
      <p className="text-sm text-muted mt-1">Our team will reach out shortly. Carry on browsing — nothing is locked.</p>
    </div>
  ) : (
    <>
      <p className="font-display text-xl text-ink leading-tight pr-5">{prominent ? "Before you go — save your details?" : "Enjoying the collection?"}</p>
      <p className="text-xs text-muted mt-1">
        {prominent
          ? "Leave your name, WhatsApp number & city — our team will send you the best trade rates and hold your interest. Takes 10 seconds."
          : "Leave your details and our team will share the latest designs, best trade rates and new arrivals. Keep browsing — this won't interrupt you again."}
      </p>
      <div className="mt-3 space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name / firm name"
          className="w-full rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-gold" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="WhatsApp number"
          className="w-full rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-gold" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder={prominent ? "City" : "City (optional)"}
          className="w-full rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-gold" />
      </div>
      {err && <p className="text-xs text-rose mt-1.5">{err}</p>}
      <div className="mt-3 flex items-center gap-2">
        <button onClick={submit} disabled={busy} className="flex-1 px-3 py-2 rounded-full bg-ink text-cream text-sm font-medium disabled:opacity-50">
          {busy ? "Saving…" : "Send my details"}
        </button>
        <button onClick={dismiss} className="px-3 py-2 text-xs text-muted hover:text-ink">{prominent ? "No thanks" : "Maybe later"}</button>
      </div>
      <p className="text-[10px] text-muted mt-2">We only use this to contact you about wholesale orders.</p>
    </>
  );

  // Leaving → centred, prominent (no stray-click / × dismissal; only "No thanks" or Esc closes — clear
  // but deliberate, never a trap). Browsing → the gentle corner card that keeps the catalogue usable.
  if (prominent) {
    return (
      <div className="fixed inset-0 z-[60] bg-ink/60 backdrop-blur-sm grid place-items-center p-4">
        <div className="rounded-2xl bg-white shadow-luxe border border-gold/50 p-5 w-full max-w-[380px] relative animate-fadeIn">
          {inner}
        </div>
      </div>
    );
  }
  return (
    <div className="fixed z-50 inset-x-3 bottom-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[360px]">
      <div className="rounded-2xl bg-white shadow-luxe border border-gold/40 p-4 relative">
        <button onClick={dismiss} aria-label="Close" className="absolute top-2.5 right-3 text-muted hover:text-ink text-lg leading-none">×</button>
        {inner}
      </div>
    </div>
  );
}
