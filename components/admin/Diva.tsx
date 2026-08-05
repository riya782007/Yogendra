"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { divaPlan, divaRun, divaTranscribe, getDivaSuggestions, type DivaSuggestion } from "@/app/actions/diva";

type Msg = { who: "owner" | "diva"; text: string };
type Step = { tool: string; args: Record<string, any>; label: string; kind: string; needsConfirm: boolean; status: "pending" | "running" | "done" | "error" | "skipped"; message?: string; confirmed?: boolean };

const STATUS_ICON: Record<string, string> = { pending: "○", running: "◔", done: "✓", error: "✕", skipped: "—" };

export function Diva({ roleName = "Owner" }: { roleName?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mrRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [msgs, setMsgs] = useState<Msg[]>([{ who: "diva", text: "Hi Yogendra, I'm DIVA. Talk to me in English, Hindi or Hinglish — e.g. “BD1010 me 20 add kar do”, “Blue kundan necklace ka stock kitna hai?”, “BD1004 ka wholesale price?”, “oxidised necklace ka catalog whatsapp pe bhejo”, “new product create karo”, “customer Ravi ko wholesale bana do”, “pending orders dikhao”. Speak or type — you can Stop me anytime." }]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<DivaSuggestion[] | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<Step[]>([]);
  const runIdRef = useRef(0);
  const ctxRef = useRef<string | undefined>(undefined);
  const sync = (s: Step[]) => { stepsRef.current = s; setSteps([...s]); };

  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, steps]);

  // Opened from the sidebar "Ask DIVA" menu item (it dispatches this event). The floating diamond
  // launcher was removed at the owner's request because it sat on the page and covered controls.
  useEffect(() => {
    const openDiva = () => setOpen(true);
    window.addEventListener("open-diva", openDiva);
    return () => window.removeEventListener("open-diva", openDiva);
  }, []);

  // Load proactive suggestions when the panel first opens.
  const loadSuggestions = () => { getDivaSuggestions().then(setSuggestions).catch(() => setSuggestions([])); };
  useEffect(() => { if (open && suggestions === null) loadSuggestions(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // VOICE via OpenAI Whisper (not the browser's speech engine, which mangles Hinglish). Record the clip,
  // then transcribe server-side and feed the text straight into DIVA. Tap once to start, tap again to stop.
  const hasVoice = typeof window !== "undefined" && typeof navigator !== "undefined"
    && !!navigator.mediaDevices?.getUserMedia && typeof (window as any).MediaRecorder !== "undefined";

  async function toggleMic() {
    if (!hasVoice) { toast("Voice recording isn't supported here — try Chrome.", "error"); return; }
    if (transcribing) return;
    if (listening) { mrRef.current?.stop(); return; } // stop → onstop transcribes
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setListening(false);
        const mime = mr.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 900) { toast("Too short — hold the mic and speak.", "error"); return; }
        setTranscribing(true);
        try {
          // Whisper picks the decoder from the file extension, so it MUST match what the browser recorded
          // (Chrome → webm/opus, Safari → mp4). A wrong extension makes Whisper reject the clip.
          const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : "webm";
          const fd = new FormData();
          fd.append("audio", blob, `voice.${ext}`);
          const r = await divaTranscribe(fd);
          if (r.ok && r.text) { setInput(r.text); submit(r.text); }
          else toast(r.error ?? "Couldn't catch that — try again.", "error");
        } catch { toast("Voice failed — try again.", "error"); }
        finally { setTranscribing(false); }
      };
      mrRef.current = mr; setListening(true); mr.start();
    } catch {
      setListening(false);
      toast("Allow the microphone so DIVA can hear you.", "error");
    }
  }

  async function submit(text?: string) {
    const cmd = (text ?? input).trim();
    if (!cmd) return;
    const myRun = ++runIdRef.current; // supersedes any in-flight run
    setInput(""); setMsgs((m) => [...m, { who: "owner", text: cmd }]); setBusy(true); setPlanning(true); setAwaiting(null); sync([]);
    const plan = await divaPlan(cmd, ctxRef.current);
    if (myRun !== runIdRef.current) return;
    setPlanning(false);
    ctxRef.current = plan.context; // carry conversational memory into the next turn
    setMsgs((m) => [...m, { who: "diva", text: plan.reply }]);
    if (plan.steps.length === 0) { setBusy(false); return; }
    sync(plan.steps.map((s) => ({ ...s, status: "pending" })));
    run(0, myRun);
  }

  async function run(i: number, myRun: number) {
    if (myRun !== runIdRef.current) return;
    const s = stepsRef.current;
    if (i >= s.length) {
      setBusy(false);
      const okN = s.filter((x) => x.status === "done").length;
      const errN = s.filter((x) => x.status === "error").length;
      const skipN = s.filter((x) => x.status === "skipped").length;
      const clean = errN === 0 && skipN === 0;
      toast(clean ? "DIVA finished ✓" : "DIVA finished with issues", clean ? undefined : "error");
      // Honest summary — never claim "Done" when a step actually failed.
      setMsgs((m) => [...m, { who: "diva", text: clean ? (okN ? "All done ✓" : "Nothing to do.") : `Finished — ${okN} done${errN ? `, ${errN} couldn't run` : ""}${skipN ? `, ${skipN} skipped` : ""}. Check the lines marked ✕.` }]);
      loadSuggestions(); return;
    }
    const step = s[i];
    if (step.needsConfirm && !step.confirmed) { setAwaiting(i); setBusy(false); return; }
    step.status = "running"; sync(s);
    const res = await divaRun(step.tool, step.args);
    if (myRun !== runIdRef.current) return; // superseded/stopped mid-step
    step.status = res.ok ? "done" : "error"; step.message = res.message; sync(s);
    if (res.message) setMsgs((m) => [...m, { who: "diva", text: res.message }]);
    if (res.navigate) router.push(res.navigate);
    setBusy(true);
    run(i + 1, myRun);
  }

  function stopRun() {
    runIdRef.current++; // invalidate the running plan
    const s = stepsRef.current.map((x) => x.status === "pending" || x.status === "running" ? { ...x, status: "skipped" as const } : x);
    sync(s); setAwaiting(null); setBusy(false); setPlanning(false);
    setMsgs((m) => [...m, { who: "diva", text: "Stopped. Tell me what to do instead." }]);
  }

  function confirmStep(i: number) { const s = stepsRef.current; s[i].confirmed = true; sync(s); setAwaiting(null); setBusy(true); run(i, runIdRef.current); }
  function skipStep(i: number) { const s = stepsRef.current; s[i].status = "skipped"; sync(s); setAwaiting(null); setBusy(true); run(i + 1, runIdRef.current); }

  return (
    <>
      {/* The floating diamond launcher was removed — DIVA now opens from the sidebar "Ask DIVA" menu
          item (which dispatches the "open-diva" event handled above), so nothing sits over the page. */}

      {/* Panel */}
      {open && (
        <div className="no-print fixed inset-0 sm:inset-auto sm:bottom-5 sm:right-5 z-50 sm:w-[400px] sm:h-[600px] sm:max-h-[85vh] bg-white sm:rounded-3xl shadow-luxe flex flex-col overflow-hidden border border-sand">
          <div className="flex items-center gap-3 px-4 py-3 bg-ink text-cream">
            <DivaAvatar className="w-10 h-10" />
            <div className="flex-1">
              <p className="font-display text-xl leading-none text-ivory">DIVA</p>
              <p className="text-[10px] tracking-widest uppercase text-gold-light">Operator · {roleName}</p>
            </div>
            <button onClick={() => setOpen(false)} className="text-cream/70 hover:text-white text-lg px-1">✕</button>
          </div>

          <div ref={logRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 bg-cream/30">
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.who === "owner" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${m.who === "owner" ? "bg-emerald text-white" : "bg-white text-ink shadow-card"}`}>{m.text}</div>
              </div>
            ))}

            {planning && (
              <div className="flex justify-start"><div className="bg-white text-muted shadow-card rounded-2xl px-3.5 py-2 text-sm flex items-center gap-2"><span className="animate-pulse">●</span> DIVA is thinking…</div></div>
            )}

            {steps.length > 0 && (
              <div className="bg-white rounded-2xl shadow-card p-3 space-y-1.5">
                <p className="text-[10px] uppercase tracking-widest text-muted mb-1">Plan</p>
                {steps.map((s, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-4 text-center ${s.status === "done" ? "text-emerald" : s.status === "error" ? "text-rose" : s.status === "running" ? "text-gold-dark animate-pulse" : "text-muted"}`}>{STATUS_ICON[s.status]}</span>
                      <span className={`flex-1 ${s.status === "skipped" ? "line-through text-muted" : "text-ink"}`}>{s.label}</span>
                      {s.needsConfirm && s.status === "pending" && <span className="text-[10px] text-gold-dark">needs OK</span>}
                    </div>
                    {awaiting === i && (
                      <div className="flex gap-2 mt-1 ml-6">
                        <button onClick={() => confirmStep(i)} className="px-3 py-1 rounded-full bg-emerald text-white text-xs">Run it</button>
                        <button onClick={() => skipStep(i)} className="px-3 py-1 rounded-full border border-sand text-muted text-xs">Skip</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="p-3 border-t border-sand bg-white">
            {busy && (
              <button onClick={stopRun} className="w-full mb-2 py-1.5 rounded-full bg-rose/10 text-rose text-xs font-medium hover:bg-rose/20 transition-colors">■ Stop</button>
            )}
            {!busy && steps.length === 0 && awaiting === null && suggestions && suggestions.length > 0 && (
              <div className="mb-2 space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-muted px-1">DIVA suggests</p>
                {suggestions.slice(0, 3).map((s) => (
                  <button key={s.id} onClick={() => submit(s.command)}
                    className="w-full text-left text-xs px-3 py-2 rounded-xl bg-cream hover:bg-emerald-mist/50 text-ink flex items-start gap-2 transition-colors">
                    <span aria-hidden>{s.icon}</span><span className="flex-1">{s.text}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={toggleMic} title={listening ? "Tap to stop" : "Tap to speak"} disabled={transcribing}
                className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${listening ? "bg-rose text-white animate-pulse" : transcribing ? "bg-cream text-ink opacity-60" : "bg-cream text-ink hover:bg-emerald-mist"}`}>{transcribing ? "⏳" : listening ? "■" : "🎤"}</button>
              <input
                value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={transcribing ? "Sun rahi hun…" : busy ? "Type to redirect DIVA…" : listening ? "🔴 Recording — tap ■ to send" : "Tell DIVA what to do…"}
                className="flex-1 rounded-full border border-sand px-4 py-2.5 text-sm outline-none focus:border-emerald" />
              <button onClick={() => submit()} disabled={!input.trim()} className="btn-primary w-10 h-10 shrink-0 rounded-full flex items-center justify-center disabled:opacity-50">➤</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** DIVA emblem — a faceted gold gem on the brand emerald disc. Deliberately NOT a human figure
 *  (the owner asked to drop the girl mascot); it reads as a jewellery mark, nothing more. */
function DivaAvatar({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="dv-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0F5C4D" /><stop offset="1" stopColor="#0A4034" />
        </linearGradient>
        <linearGradient id="dv-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E2C887" /><stop offset="1" stopColor="#C8A24C" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#dv-bg)" stroke="#C8A24C" strokeWidth="2.5" />
      {/* faceted gem / diamond */}
      <g stroke="#8C6E2A" strokeWidth="1" strokeLinejoin="round">
        <path d="M34 42h32l-16 30z" fill="url(#dv-gold)" />
        <path d="M34 42l7-11h18l7 11z" fill="#EBD79A" />
        <path d="M41 31l4 11h10l4-11z" fill="#D9BD6B" />
      </g>
      {/* crown facet lines */}
      <path d="M34 42l16 30 16-30M41 42l9 30 9-30M50 31v11" stroke="#A9863A" strokeWidth="0.9" fill="none" />
      {/* sparkle */}
      <path d="M74 30l1.6 4.2L80 36l-4.4 1.8L74 42l-1.6-4.2L68 36l4.4-1.8z" fill="#F4E7B8" />
    </svg>
  );
}
