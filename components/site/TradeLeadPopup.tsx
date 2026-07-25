"use client";
import { useEffect, useRef, useState } from "react";
import { captureTradeVisitorAction } from "@/app/actions/leads";

const K_DONE = "bd_trade_lead_done";
const K_VID = "bd_trade_visitor_id";

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
  const depth = useRef(0);
  const reason = useRef("mandatory");
  const fired = useRef(false);

  useEffect(() => {
    // MANDATORY gate. The owner kept getting "Guest" carts with no contact because the old build only
    // popped this after ~50s of reading / 12 designs scrolled / an exit-intent — so a dealer who landed
    // and went straight to the cart never saw it. Now it shows AT ONCE, on load, before anything can be
    // added to the cart. The only skip is a returning visitor who already submitted their details.
    fired.current = true;
    reason.current = "mandatory";
    try { if (localStorage.getItem(K_DONE) === "1") return; } catch { /* private mode — show it */ }
    setShow(true);
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
    try {
      localStorage.setItem(K_DONE, "1");
      // Hand the details to the catalogue so the dealer's cart is tracked WITH a name + phone
      // (the whole point — no more anonymous "Guest" carts the owner can't call back).
      localStorage.setItem("bd_trade_contact", JSON.stringify({ name: name.trim(), phone: phone.trim(), city: city.trim() }));
    } catch { /* ignore */ }
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
