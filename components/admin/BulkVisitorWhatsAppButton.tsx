"use client";
import { useMemo, useState } from "react";
import { SITE } from "@/lib/siteUrl";

type V = { id: string; name: string | null; phone: string | null; city: string | null; designs_viewed: number | null; status: string };

const K_DONE = "bd_visitor_messaged_v1";

/** Same warm lead message the per-visitor card uses. */
function waLink(v: V): string | null {
  let phone = v.phone ? String(v.phone).replace(/\D/g, "") : "";
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (phone.length === 10) phone = "91" + phone;
  if (phone.length < 11) return null;
  const msg = `Namaste ${v.name || "ji"}! 🙏 This is Blythe Diva (Sadar Bazar, Delhi) — thank you for viewing our wholesale catalogue!\n\n✨ 2000+ latest designs · best trade rates · new arrivals every week.\n\nMain aapko first order me help karna chahungi — bas 2 minute lagenge:\n👉 ${SITE}/trade\n\nAgar koi dikkat aayi ho — rate, minimum order, ya koi design nahi mili — bas reply kar dijiye, main khud aapke liye sort kar dungi. 🌸`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

/**
 * One-at-a-time bulk WhatsApp outreach for the trade visitors (leads). Walks the owner through the list:
 * opens the next dealer's chat with the message pre-filled → he taps send → comes back and hits "Sent · next".
 * Progress is remembered (localStorage) so he can stop and resume. Only leads WITH a phone are included.
 */
export function BulkVisitorWhatsAppButton({ visitors }: { visitors: V[] }) {
  const contactable = useMemo(() => visitors.filter((v) => waLink(v)), [visitors]);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(K_DONE) || "[]")); } catch { return new Set(); }
  });
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const persist = (s: Set<string>) => { try { localStorage.setItem(K_DONE, JSON.stringify([...s])); } catch { /* private mode */ } };
  const queue = contactable.filter((v) => !done.has(v.id) && !skipped.has(v.id));
  const current = queue[0] ?? null;
  const sentCount = contactable.filter((v) => done.has(v.id)).length;

  function markSentAndOpen() {
    if (!current) return;
    const link = waLink(current);
    if (link) window.open(link, "_blank", "noopener");
    const next = new Set(done); next.add(current.id); setDone(next); persist(next);
  }
  function skip() { if (current) setSkipped((s) => new Set(s).add(current.id)); }
  function resetProgress() { setDone(new Set()); setSkipped(new Set()); persist(new Set()); }

  if (contactable.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-[#25D366] text-white px-4 py-2 text-sm font-semibold hover:brightness-95"
        title="Message every lead that has a phone number, one after another"
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.2-.2.3-.7.8-.9 1-.2.2-.3.2-.6.1-1.5-.8-2.5-1.4-3.5-3.1-.3-.5.3-.4.7-1.3.1-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2z" /></svg>
        Message all leads ({contactable.length - sentCount})
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] bg-ink/50 backdrop-blur-sm grid place-items-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-luxe w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-2xl text-ink">Message trade leads</h2>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink text-xl leading-none">✕</button>
            </div>
            <p className="text-xs text-muted mb-4">
              Sent {sentCount} of {contactable.length}. Tap <b>Open WhatsApp</b> → press send in WhatsApp → come back and tap <b>Sent · next</b>. Progress is saved, so you can stop and continue anytime.
            </p>

            <div className="h-2 rounded-full bg-cream overflow-hidden mb-5">
              <div className="h-full bg-[#25D366] transition-all" style={{ width: `${Math.round((sentCount / contactable.length) * 100)}%` }} />
            </div>

            {current ? (
              <div className="rounded-xl border border-sand p-4 mb-4">
                <p className="font-medium text-ink">{current.name || "Dealer"}</p>
                <p className="text-sm text-muted">{current.city || "—"} · viewed {current.designs_viewed ?? 0} designs</p>
                <p className="text-xs text-muted mt-1">📞 {current.phone}</p>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-mist text-emerald-dark p-4 mb-4 text-center text-sm font-medium">🎉 All leads have been messaged!</div>
            )}

            <div className="flex items-center gap-2">
              {current && (
                <>
                  <button onClick={markSentAndOpen} className="flex-1 rounded-full bg-[#25D366] text-white px-4 py-2.5 text-sm font-semibold hover:brightness-95">
                    Open WhatsApp · Sent → next
                  </button>
                  <button onClick={skip} className="rounded-full border border-sand px-4 py-2.5 text-sm text-ink hover:border-gold">Skip</button>
                </>
              )}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs">
              <button onClick={resetProgress} className="text-muted hover:text-rose">Reset progress</button>
              <span className="text-muted">{queue.length} remaining</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
