"use client";
import { useState } from "react";
import { createDesignEnquiryAction } from "@/app/actions/enquiries";

/** The shop's WhatsApp. Env-overridable so the owner can change it without a code change. */
const SHOP_WA = (process.env.NEXT_PUBLIC_SHOP_WHATSAPP ?? "919582002623").replace(/\D/g, "");

type Mode = "video_call" | "store_visit" | "whatsapp";
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "video_call",  label: "📹 Video call",  hint: "We'll show you the full range live on a call" },
  { key: "store_visit", label: "🏬 Store visit",  hint: "See and handle every piece at our Sadar Bazar store" },
  { key: "whatsapp",    label: "💬 WhatsApp",     hint: "We'll send photos of the remaining designs" },
];

/**
 * Shown on designs whose full colour range is too large for the catalogue. The dealer picks how they'd
 * like to see the rest; we RECORD the request for the owner's dashboard and then open WhatsApp so the
 * dealer still gets an instant human reply. Recording first means a serious enquiry is never lost.
 */
export function MoreDesignsButton({ sku, productName, note, dealerName = "" }: {
  sku: string; productName: string; note?: string | null; dealerName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("video_call");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function send() {
    setBusy(true);
    const r = await createDesignEnquiryAction({ sku, mode, note: msg });
    setBusy(false);
    if (!r.ok) { alert(r.error ?? "Couldn't send — please WhatsApp us directly."); return; }
    setDone(true);
    const chosen = MODES.find((m) => m.key === mode)?.label.replace(/^\S+\s/, "") ?? "WhatsApp";
    const text =
      `Hi Blythe Diva! ${dealerName ? `${dealerName} here. ` : ""}I'd like to see ALL available designs/colours for ${productName} (${sku}).` +
      `\nPreferred: ${chosen}.${msg ? `\nNote: ${msg}` : ""}`;
    window.open(`https://wa.me/${SHOP_WA}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium text-gold-dark bg-gold/10 hover:bg-gold/20 border border-gold/30 rounded-full px-2.5 py-1 transition"
        title="More colours & designs are available beyond this catalogue"
      >
        ✨ More designs available
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-gold/40 bg-cream/50 p-3">
      {done ? (
        <div className="text-[11px]">
          <p className="text-emerald-dark font-medium">Request sent ✓</p>
          <p className="text-muted mt-0.5">Our team has it and will get back to you. WhatsApp should have opened too — if it didn&apos;t, message us on +91 95820 02623.</p>
          <button onClick={() => { setOpen(false); setDone(false); setMsg(""); }} className="mt-1.5 text-muted underline">Close</button>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-ink font-medium">See the full range of this design</p>
          <p className="text-[11px] text-muted mt-0.5">
            {note?.trim() ? note : "This design comes in more colours and variations than we can list here."} How would you like to see them?
          </p>
          <div className="mt-2 space-y-1">
            {MODES.map((m) => (
              <label key={m.key} className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 cursor-pointer transition ${mode === m.key ? "border-gold bg-white" : "border-sand/70 hover:border-gold/50"}`}>
                <input type="radio" name={`mode-${sku}`} checked={mode === m.key} onChange={() => setMode(m.key)} className="mt-0.5 accent-gold-dark" />
                <span>
                  <span className="block text-[11px] font-medium text-ink">{m.label}</span>
                  <span className="block text-[10px] text-muted leading-tight">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            placeholder="Anything specific? (e.g. rose gold, bridal sets, bulk qty)"
            className="mt-2 w-full rounded-lg border border-sand px-2 py-1.5 text-[11px] outline-none focus:border-gold"
          />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={send} disabled={busy} className="px-3 py-1.5 rounded-full bg-ink text-cream text-[11px] font-medium disabled:opacity-50">
              {busy ? "Sending…" : "Send request"}
            </button>
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 rounded-full border border-sand text-muted text-[11px]">Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
