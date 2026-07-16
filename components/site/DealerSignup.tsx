"use client";
/**
 * DealerSignup — public "Become a dealer" application on the trade login page. Collects the reseller's
 * firm details + a business-proof image, creates a PENDING wholesale customer, and pings the owner.
 */
import { useState } from "react";
import { applyForWholesaleAction } from "@/app/actions/wholesale";

export function DealerSignup() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");
  const [proofName, setProofName] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Business proof is OPTIONAL (owner: small resellers were put off by a mandatory upload).
    setBusy(true); setErr("");
    const res = await applyForWholesaleAction(fd);
    setBusy(false);
    if (res.ok) setDone(true);
    else setErr(res.error ?? "Something went wrong — please try again.");
  }

  if (done) {
    return (
      <div className="bg-white rounded-2xl shadow-card p-7 border border-emerald/30 text-center">
        <p className="text-4xl mb-2">✓</p>
        <h3 className="font-display text-2xl text-ink">Application received</h3>
        <p className="text-sm text-muted mt-2">Thank you! Our team will verify your business shortly.</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-mist/60 text-emerald-dark text-sm px-4 py-2.5 font-medium">
          <span className="text-lg">📲</span> Please check your <b>WhatsApp</b> — we&apos;ll confirm there once approved. After that, just sign in with <b>this same phone number</b> — no code needed.
        </p>
      </div>
    );
  }

  const field = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl shadow-card p-6 border border-sand">
      <h3 className="font-display text-2xl text-ink">Become a dealer</h3>
      <p className="text-xs text-muted mt-1 mb-4">New reseller? Apply for a wholesale account. Our team verifies your business and activates trade prices.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <input name="name" required placeholder="Name / firm *" className={`${field} sm:col-span-2`} />
        <input name="phone" required inputMode="tel" placeholder="Phone * (add country code if outside India)" className={field} />
        <input name="city" placeholder="City" className={field} />
        <input name="gstin" placeholder="GSTIN (optional)" className={`${field} uppercase`} />
        <input name="email" type="email" placeholder="Email (optional)" className={field} />
        <input name="address" placeholder="Shop / business address" className={`${field} sm:col-span-2`} />
      </div>
      <label className="block mt-3">
        <span className="block text-xs font-medium text-ink mb-1">Business proof <span className="text-muted/70 font-normal">(optional — speeds up approval)</span></span>
        <span className="block text-[11px] text-muted mb-1.5">If you have one, add a screenshot that shows you run a business — your <b>Instagram business page</b>, <b>website</b>, GST certificate, shop photo or visiting card. It just helps us approve you faster; nothing is shared publicly. No document? No problem — just apply and we&apos;ll reach out on WhatsApp.</span>
        <label className={`flex items-center gap-3 rounded-xl border border-dashed px-3 py-3 cursor-pointer transition-colors ${proofName ? "border-emerald/50 bg-emerald-mist/30 hover:bg-emerald-mist/50" : "border-sand hover:border-emerald/50 bg-cream/30"}`}>
          <span className="text-xl">📄</span>
          <span className="text-sm text-ink truncate">{proofName || "Tap to add a screenshot (optional)"}</span>
          <input type="file" name="proof" accept="image/*" className="hidden" onChange={(e) => setProofName(e.target.files?.[0]?.name ?? "")} />
        </label>
      </label>
      {err && <p className="text-sm text-rose mt-2">{err}</p>}
      <button disabled={busy} className="btn-primary w-full mt-4 py-3 text-sm font-medium disabled:opacity-60">{busy ? "Submitting…" : "Apply for wholesale access"}</button>
    </form>
  );
}
