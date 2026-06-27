"use client";
import { useState } from "react";
import { submitFeedbackAction } from "@/app/actions/feedback";

export function FeedbackForm({ storePhone, orderRef = "" }: { storePhone: string; orderRef?: string }) {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [msg, setMsg] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const waText = encodeURIComponent(
    `Feedback for Blythe Diva${orderRef ? ` (Order ${orderRef})` : ""}: ${rating ? `${rating}★ — ` : ""}${msg}${name ? `\n— ${name}` : ""}`,
  );
  const waHref = `https://wa.me/91${storePhone}?text=${waText}`;
  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";

  async function submit() {
    if (!rating && !msg.trim()) { setErr("Add a rating or a few words first."); return; }
    setBusy(true); setErr("");
    const res = await submitFeedbackAction({ name, phone, rating, message: msg, orderRef });
    setBusy(false);
    if (res.ok) setDone(true); else setErr(res.error ?? "Couldn't submit — try the WhatsApp button.");
  }

  if (done) return (
    <div className="text-center py-6">
      <p className="text-5xl">💛</p>
      <h2 className="font-display text-2xl text-ink mt-2">Thank you!</h2>
      <p className="text-sm text-muted mt-1">We've received your feedback and truly appreciate it.</p>
      <a href={waHref} target="_blank" rel="noreferrer" className="inline-block mt-4 px-5 py-3 rounded-full bg-[#25D366] text-white text-sm font-medium">Also send us on WhatsApp →</a>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 justify-center text-4xl">
        {[1, 2, 3, 4, 5].map((s) => (
          <button key={s} type="button" onClick={() => setRating(s)} onMouseEnter={() => setHover(s)} onMouseLeave={() => setHover(0)}
            className={`transition-transform hover:scale-110 ${(hover || rating) >= s ? "text-gold" : "text-sand"}`} aria-label={`${s} star${s > 1 ? "s" : ""}`}>★</button>
        ))}
      </div>
      <textarea className={input} rows={4} placeholder="Tell us about your experience — what you loved, what we can improve…" value={msg} onChange={(e) => setMsg(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className={input} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      {err && <p className="text-sm text-rose">{err}</p>}
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="btn-primary flex-1 py-3 text-sm font-medium disabled:opacity-50">{busy ? "Sending…" : "Submit feedback"}</button>
        <a href={waHref} target="_blank" rel="noreferrer" title="Send on WhatsApp" className="px-5 py-3 rounded-full bg-[#25D366] text-white text-sm font-medium grid place-items-center">WhatsApp</a>
      </div>
      <p className="text-[11px] text-muted text-center">Submitting saves it for the store; the WhatsApp button also sends it straight to us.</p>
    </div>
  );
}
