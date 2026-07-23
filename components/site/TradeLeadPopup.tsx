"use client";
import { useEffect, useRef, useState } from "react";
import { captureTradeVisitorAction } from "@/app/actions/leads";

const K_DONE = "bd_trade_lead_done";
const K_SNOOZE = "bd_trade_lead_snooze_until";
const K_VID = "bd_trade_visitor_id";

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

    const trigger = (why: string) => {
      if (fired.current) return;
      if (seconds.current < MIN_SECONDS) return;
      // Never interrupt mid-typing (search box, quantity field…).
      const el = document.activeElement?.tagName?.toLowerCase();
      if (el === "input" || el === "textarea" || el === "select") return;
      fired.current = true;
      reason.current = why;
      setShow(true);
    };

    // EXIT INTENT (desktop): the cursor leaves through the top of the window — they're heading for the
    // tab bar / close / address bar. Last chance to catch a leaving dealer, so show the prominent form.
    const onExit = (e: MouseEvent) => {
      if (e.clientY <= 0 && !e.relatedTarget) trigger("exit");
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

  async function submit() {
    // Name + phone are what make a lead usable — without them the owner just gets another "Guest".
    if (!name.trim() || !phone.trim()) { setErr("Please add your name and phone number."); return; }
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
    <div className="py-2 text-center">
      <p className="font-medium text-emerald-dark">Thank you 🙏</p>
      <p className="text-sm text-muted mt-1">Our team will reach out shortly. Carry on browsing — nothing is locked.</p>
    </div>
  ) : (
    <>
      <p className="font-display text-xl text-ink leading-tight pr-6">Enjoying the collection?</p>
      <p className="text-xs text-muted mt-1">Leave your details and our team will share the latest designs, best trade rates and new arrivals.</p>
      <div className="mt-3 space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name"
          className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-gold" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="Phone number"
          className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-gold" />
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City"
          className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-gold" />
      </div>
      {err && <p className="text-xs text-rose mt-1.5">{err}</p>}
      <button onClick={submit} disabled={busy} className="w-full mt-3 px-3 py-2.5 rounded-full bg-ink text-cream text-sm font-medium disabled:opacity-50">
        {busy ? "Saving…" : "Submit"}
      </button>
      <p className="text-[10px] text-muted mt-2 text-center">We only use this to contact you about wholesale orders.</p>
    </>
  );

  // MANDATORY centred popup over a blurred backdrop (owner: "mandatory karna hi hota hai, otherwise cart
  // submit/surf nai hogi"). No × and no Esc — the dealer must enter Name + Phone + City and Submit to
  // continue browsing. The backdrop covers the page so nothing behind it is clickable until they submit.
  return (
    <div className="fixed inset-0 z-[60] bg-ink/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="rounded-2xl bg-white shadow-luxe border border-gold/50 p-5 w-full max-w-[380px] relative animate-fadeIn">
        {inner}
      </div>
    </div>
  );
}
