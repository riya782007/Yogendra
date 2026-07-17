"use client";

import { useEffect, useState } from "react";

/** Detects when a NEWER build has been deployed than the one this browser tab is running, and offers
 *  a one-click refresh. This is why "it works on one laptop but not another" — the other laptop is on
 *  an older cached version. Now every tab knows within a minute and can update itself. The prompt is
 *  non-intrusive (a small banner) and NEVER auto-reloads, so an in-progress bill is never lost. */
export function VersionWatcher({ current }: { current: string }) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    if (!current || current === "dev") return; // local dev: nothing to compare against
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json();
        if (alive && j?.v && j.v !== current) setStale(true);
      } catch { /* offline / transient — try again next tick */ }
    };
    check();
    const id = setInterval(check, 60_000); // check every minute
    const onFocus = () => check();          // and whenever the staffer comes back to the tab
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener("focus", onFocus); };
  }, [current]);

  if (!stale) return null;
  return (
    <div className="no-print fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-full bg-ink text-cream shadow-luxe px-4 py-2.5 text-sm">
      <span className="w-2 h-2 rounded-full bg-emerald-light animate-pulse" />
      <span>A newer version is live on the server.</span>
      <button onClick={() => location.reload()} className="px-3 py-1 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark">Update now</button>
      <button onClick={() => setStale(false)} className="text-cream/60 hover:text-cream text-xs" title="Hide — finish your bill first">Later</button>
    </div>
  );
}
