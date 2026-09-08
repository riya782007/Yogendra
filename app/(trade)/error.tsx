"use client";
import { useEffect, useRef, useState } from "react";

export default function TradeError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [phase, setPhase] = useState<"retrying" | "manual">("retrying");
  const autoTried = useRef(false);
  useEffect(() => {
    if (!autoTried.current) {
      autoTried.current = true;
      const t = setTimeout(() => reset(), 700);
      const done = setTimeout(() => setPhase("manual"), 1600);
      return () => { clearTimeout(t); clearTimeout(done); };
    }
  }, [reset]);
  return (
    <div className="min-h-[60vh] grid place-items-center p-8 text-center">
      <div className="max-w-sm">
        <p className="text-4xl mb-2">💎</p>
        <h2 className="font-display text-2xl text-ink">Catalogue is waking up</h2>
        <p className="text-sm text-muted mt-1">{phase === "retrying" ? "Loading designs…" : "Please retry — the wholesale catalogue is still here."}</p>
        <div className="flex justify-center gap-2 mt-4">
          <button onClick={() => { autoTried.current = false; setPhase("retrying"); reset(); }} className="px-5 py-2.5 rounded-full bg-ink text-white text-sm font-medium">Retry</button>
          <a href="/trade" className="px-5 py-2.5 rounded-full bg-ink/5 text-ink text-sm">Reload catalogue</a>
        </div>
      </div>
    </div>
  );
}
