"use client";
/**
 * Customer login — phone → WhatsApp OTP → signed in. Two steps, no passwords. On success the page
 * re-renders as the profile (the session cookie is set by the verify action).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendCustomerOtpAction, verifyCustomerOtpAction } from "@/app/actions/customerAuth";

const field = "w-full rounded-xl border border-sand bg-white px-4 py-3 text-sm outline-none focus:border-emerald transition";

export function CustomerLogin() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  async function send() {
    const p = phone.replace(/\D/g, "").slice(-10);
    if (p.length !== 10) { setMsg("Enter a valid 10-digit mobile number."); return; }
    setBusy(true); setMsg("");
    const r = await sendCustomerOtpAction(p);
    setBusy(false);
    if (r.ok) { setStep("code"); setDevCode(r.devCode ?? null); setMsg(r.devCode ? "" : "We've sent a code to your WhatsApp."); }
    else setMsg(r.error ?? "Couldn't send the code.");
  }

  async function verify() {
    setBusy(true); setMsg("");
    const r = await verifyCustomerOtpAction({ phone, code, name });
    setBusy(false);
    if (r.ok) router.refresh(); // page re-renders as the signed-in profile
    else setMsg(r.error ?? "Couldn't verify the code.");
  }

  return (
    <div className="bg-white rounded-2xl shadow-card p-6">
      {step === "phone" ? (
        <>
          <p className="text-sm text-muted mb-3">Sign in with your mobile number — we'll WhatsApp you a one-time code. No password needed.</p>
          <label className="block text-xs font-medium text-muted mb-1">Mobile number</label>
          <div className="flex items-center gap-2">
            <span className="px-3 py-3 rounded-xl bg-cream text-sm text-muted">+91</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              inputMode="numeric" placeholder="10-digit mobile" className={field} autoFocus />
          </div>
          <button onClick={send} disabled={busy} className="btn-primary w-full mt-4 py-3 text-sm font-medium disabled:opacity-50">
            {busy ? "Sending…" : "Send code on WhatsApp"}
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-muted mb-3">Enter the code we sent to <b className="text-ink">+91 {phone.replace(/\D/g, "").slice(-10)}</b>. <button onClick={() => { setStep("phone"); setCode(""); setMsg(""); }} className="text-emerald nav-link">Change number</button></p>
          {devCode && <p className="text-xs text-gold-dark bg-gold/10 rounded-lg px-3 py-2 mb-3">WhatsApp isn't connected yet, so here's your code for now: <b>{devCode}</b></p>}
          <label className="block text-xs font-medium text-muted mb-1">One-time code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") verify(); }}
            inputMode="numeric" placeholder="6-digit code" className={`${field} tracking-[0.3em] text-center`} autoFocus />
          <label className="block text-xs font-medium text-muted mb-1 mt-3">Your name <span className="text-muted/70">(optional)</span></label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className={field} />
          <button onClick={verify} disabled={busy} className="btn-primary w-full mt-4 py-3 text-sm font-medium disabled:opacity-50">
            {busy ? "Verifying…" : "Verify & sign in"}
          </button>
          <button onClick={send} disabled={busy} className="w-full mt-2 text-xs text-muted hover:text-emerald">Resend code</button>
        </>
      )}
      {msg && <p className="text-sm mt-3 text-ink">{msg}</p>}
    </div>
  );
}
