"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Friendly error boundary for the whole owner console. A cold serverless start can
 * 503 the first request after idle; instead of a blank/ugly error page we auto-retry
 * once (a warm function almost always succeeds), then offer clear manual retry.
 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [phase, setPhase] = useState<"retrying" | "manual">("retrying");
  const autoTried = useRef(false);

  useEffect(() => {
    if (!autoTried.current) {
      autoTried.current = true;
      const t = setTimeout(() => reset(), 700); // one automatic retry with a short backoff
      const done = setTimeout(() => setPhase("manual"), 1600);
      return () => { clearTimeout(t); clearTimeout(done); };
    } else {
      setPhase("manual");
    }
  }, [reset]);

  return (
    <div className="min-h-[60vh] grid place-items-center p-8 text-center bg-cream/40">
      <div className="max-w-sm">
        <p className="text-4xl mb-2">😕</p>
        <h2 className="font-display text-2xl text-ink">Couldn&apos;t load that page</h2>
        <p className="text-sm text-muted mt-1">
          {phase === "retrying"
            ? "One moment — retrying…"
            : "The server was waking up (this can happen on the first click after a quiet spell). It usually loads on the next try."}
        </p>
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => { autoTried.current = false; setPhase("retrying"); reset(); }} className="px-5 py-2.5 rounded-full bg-ink text-white text-sm font-medium hover:bg-ink/90">Retry</button>
          <button onClick={() => location.reload()} className="px-5 py-2.5 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10">Reload</button>
        </div>
        {error?.digest && <p className="text-[10px] text-muted/60 mt-4">ref {error.digest}</p>}
      </div>
    </div>
  );
}
