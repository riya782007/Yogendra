"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { divaPlan, divaRun, getDivaSuggestions, type DivaSuggestion } from "@/app/actions/diva";

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
  const [msgs, setMsgs] = useState<Msg[]>([{ who: "diva", text: "Hi Yogendra, I'm DIVA. Talk to me in English, Hindi or Hinglish — e.g. “BD1010 me 20 add kar do”, “Blue kundan necklace ka stock kitna hai?”, “BD1004 ka wholesale price?”, “oxidised necklace ka catalog whatsapp pe bhejo”, “new product create karo”, “customer Ravi ko wholesale bana do”, “pending orders dikhao”. Speak or type — you can Stop me anytime." }]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<DivaSuggestion[] | null>(null);
  const recRef = useRef<any>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<Step[]>([]);
  const runIdRef = useRef(0);
  const ctxRef = useRef<string | undefined>(undefined);
  const sync = (s: Step[]) => { stepsRef.current = s; setSteps([...s]); };

  useEffect(() => { logRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [msgs, steps]);

  // Load proactive suggestions when the panel first opens.
  const loadSuggestions = () => { getDivaSuggestions().then(setSuggestions).catch(() => setSuggestions([])); };
  useEffect(() => { if (open && suggestions === null) loadSuggestions(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasVoice = typeof window !== "undefined" && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  function toggleMic() {
    if (!hasVoice) { toast("Voice isn't supported in this browser — try Chrome.", "error"); return; }
    if (listening) { recRef.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR(); rec.lang = "en-IN"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput(t); submit(t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec; setListening(true); rec.start();
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
      {/* Floating avatar */}
      {!open && (
        <button onClick={() => setOpen(true)} className="no-print fixed bottom-5 right-5 z-50 group flex items-center gap-2">
          <span className="hidden sm:block bg-ink text-cream text-xs px-3 py-1.5 rounded-full shadow-luxe opacity-0 group-hover:opacity-100 transition-opacity">Ask DIVA</span>
          <span className="relative block">
            <span className="absolute inset-0 rounded-full bg-emerald/40 animate-ping" />
            <DivaAvatar className="relative w-16 h-16 drop-shadow-xl" />
          </span>
        </button>
      )}

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
              <button onClick={toggleMic} title="Speak" className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center transition-colors ${listening ? "bg-rose text-white animate-pulse" : "bg-cream text-ink hover:bg-emerald-mist"}`}>🎤</button>
              <input
                value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder={busy ? "Type to redirect DIVA…" : listening ? "Listening…" : "Tell DIVA what to do…"}
                className="flex-1 rounded-full border border-sand px-4 py-2.5 text-sm outline-none focus:border-emerald" />
              <button onClick={() => submit()} disabled={!input.trim()} className="btn-primary w-10 h-10 shrink-0 rounded-full flex items-center justify-center disabled:opacity-50">➤</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Stylised "DIVA" human-figure avatar (brand emerald/gold). */
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
      {/* hair */}
      <path d="M30 48c0-15 9-25 20-25s20 10 20 25c0 6-2 12-4 16-1-10-2-20-8-24-3 6-18 6-22 0-4 5-5 14-6 22-1-4-0-9 0-14z" fill="#241B2E" />
      {/* face */}
      <path d="M37 44c0 11 6 19 13 19s13-8 13-19c0-9-6-14-13-14s-13 5-13 14z" fill="#F2D7BE" />
      {/* eyes + smile */}
      <circle cx="45" cy="45" r="1.6" fill="#241B2E" /><circle cx="55" cy="45" r="1.6" fill="#241B2E" />
      <path d="M46 52c2 2 6 2 8 0" stroke="#A07E2E" strokeWidth="1.4" fill="none" strokeLinecap="round" />
      {/* earrings */}
      <circle cx="37" cy="50" r="2.3" fill="url(#dv-gold)" /><circle cx="63" cy="50" r="2.3" fill="url(#dv-gold)" />
      {/* shoulders + necklace */}
      <path d="M28 84c2-12 10-18 22-18s20 6 22 18z" fill="#6E2238" />
      <path d="M42 70c3 5 13 5 16 0" stroke="url(#dv-gold)" strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="50" cy="74" r="2.4" fill="url(#dv-gold)" />
    </svg>
  );
}
