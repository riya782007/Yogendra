"use client";
import { useEffect, useState } from "react";
import { composeLeadMessageAction } from "@/app/actions/leads";
import { defaultLeadMessage, waLinkFor } from "@/lib/leadMessage";

export type Lead = { name?: string | null; phone?: string | null; city?: string | null; designsViewed?: number | null };

const QUICK: { label: string; instruction: string }[] = [
  { label: "Shorter", instruction: "Make it noticeably shorter and punchier." },
  { label: "Warmer", instruction: "Make it warmer and more personal." },
  { label: "More formal", instruction: "Make it a bit more formal and professional." },
  { label: "Festive offer", instruction: "Add a warm festive-season note inviting them to ask about the latest arrivals (do not invent a specific discount)." },
];

/**
 * The editable-with-AI message panel. Starts from the standard warm template, the owner can edit it by
 * hand OR tap a quick tone / type an instruction and DIVA rewrites it. "Open WhatsApp" uses the FINAL
 * edited text. Reusable: the per-lead card wraps it in a modal, the bulk sender embeds it inline.
 */
export function LeadMessageEditor({ lead, onOpened, autoFocus }: { lead: Lead; onOpened?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState(() => defaultLeadMessage(lead.name));
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // When the lead changes (bulk sender advancing to the next dealer), reset to that lead's template.
  useEffect(() => { setText(defaultLeadMessage(lead.name)); setInstruction(""); setErr(""); }, [lead.name, lead.phone]);

  async function improve(instr: string) {
    const ins = instr.trim();
    if (!ins) { setErr("Type what to change, or tap a quick option."); return; }
    setBusy(true); setErr("");
    const r = await composeLeadMessageAction({
      name: lead.name, city: lead.city, designsViewed: lead.designsViewed,
      currentText: text, instruction: ins,
    });
    setBusy(false);
    if (r.text) setText(r.text);           // AI rewrite (or the untouched text on fallback)
    if (!r.ok && r.error) setErr(r.error); // e.g. no API key — owner can still edit by hand
    else setInstruction("");
  }

  const link = waLinkFor(lead.phone, text);

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={8}
        autoFocus={autoFocus}
        className="w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm outline-none focus:border-emerald leading-relaxed resize-y"
      />

      <div className="flex flex-wrap gap-1.5 mt-2">
        {QUICK.map((q) => (
          <button key={q.label} onClick={() => improve(q.instruction)} disabled={busy}
            className="px-2.5 py-1 rounded-full border border-sand text-[11px] text-ink hover:border-emerald disabled:opacity-50">
            {q.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mt-2">
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); improve(instruction); } }}
          placeholder="Tell DIVA what to change…"
          className="flex-1 rounded-xl border border-sand px-3.5 py-2 text-sm outline-none focus:border-emerald"
        />
        <button onClick={() => improve(instruction)} disabled={busy}
          className="px-3.5 py-2 rounded-xl bg-gold/15 text-gold-dark text-sm font-medium hover:bg-gold/25 disabled:opacity-50 whitespace-nowrap">
          {busy ? "Writing…" : "✨ Improve with AI"}
        </button>
      </div>

      {err && <p className="text-xs text-rose mt-2">{err}</p>}

      <a
        href={link ?? undefined}
        onClick={(e) => { if (!link) { e.preventDefault(); setErr("No valid phone number for this lead."); return; } onOpened?.(); }}
        target="_blank" rel="noreferrer"
        className={`mt-3 block text-center rounded-full px-4 py-2.5 text-sm font-semibold text-white ${link ? "bg-[#25D366] hover:brightness-95" : "bg-ink/20 cursor-not-allowed"}`}
      >
        Open WhatsApp with this message →
      </a>
    </div>
  );
}

/** Per-lead trigger + modal wrapper around the editor (used on the visitors list cards). */
export function LeadMessageComposer({ lead }: { lead: Lead }) {
  const [open, setOpen] = useState(false);
  if (!waLinkFor(lead.phone, "x")) return null; // no phone → no WhatsApp
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark">
        WhatsApp →
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-luxe border border-sand p-5 max-w-md w-full">
            <div className="flex items-center justify-between mb-1">
              <p className="font-medium text-ink">Message {lead.name || "lead"}</p>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink text-xl leading-none">✕</button>
            </div>
            <p className="text-xs text-muted mb-3">Edit the message or tap <b>Improve with AI</b>, then open WhatsApp to send.</p>
            <LeadMessageEditor lead={lead} onOpened={() => setOpen(false)} autoFocus />
          </div>
        </div>
      )}
    </>
  );
}
