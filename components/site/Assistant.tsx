"use client";
import { useState, useRef, useEffect } from "react";
import { askAssistantAction } from "@/app/actions/assistant";

type Msg = { role: "user" | "diva"; text: string };

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([{ role: "diva", text: "Hi, I'm Diva ✨ Looking for something special? Tell me the occasion or your budget and I'll suggest pieces." }]);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);

  async function send() {
    const q = input.trim(); if (!q || busy) return;
    setInput(""); setMsgs((m) => [...m, { role: "user", text: q }]); setBusy(true);
    const res = await askAssistantAction(q);
    setMsgs((m) => [...m, { role: "diva", text: res.reply }]); setBusy(false);
  }

  return (
    <>
      <button aria-label="Chat with Diva" onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 right-5 z-50 h-14 w-14 rounded-full bg-ink text-gold-light shadow-luxe grid place-items-center text-2xl hover:scale-105 transition-transform">
        {open ? "✕" : "✦"}
      </button>
      {open && (
        <div className="fixed bottom-24 right-5 z-50 w-[92vw] max-w-sm bg-ivory rounded-2xl shadow-luxe border border-sand flex flex-col overflow-hidden animate-[fadeUp_.3s_ease]" style={{ height: "min(70vh, 520px)" }}>
          <div className="bg-ink text-cream px-4 py-3 flex items-center gap-2">
            <span className="h-8 w-8 rounded-full bg-gold/20 grid place-items-center text-gold-light">✦</span>
            <div><p className="font-medium text-sm leading-none">Diva</p><p className="text-[11px] text-cream/60">Your jewellery concierge</p></div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {msgs.map((m, i) => (
              <div key={i} className={`max-w-[85%] text-sm rounded-2xl px-3.5 py-2.5 ${m.role === "user" ? "ml-auto bg-emerald text-white" : "bg-white text-ink shadow-sm"}`}>{m.text}</div>
            ))}
            {busy && <div className="bg-white text-muted text-sm rounded-2xl px-3.5 py-2.5 shadow-sm w-16"><span className="animate-pulse">· · ·</span></div>}
            <div ref={endRef} />
          </div>
          <div className="p-3 border-t border-sand flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder="Ask Diva…" className="flex-1 rounded-full border border-sand px-4 py-2 text-sm bg-white outline-none focus:border-emerald" />
            <button onClick={send} disabled={busy} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">Send</button>
          </div>
        </div>
      )}
    </>
  );
}
