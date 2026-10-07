"use client";
/**
 * Phone BACK button closes the open panel instead of leaving the page.
 *
 * Owner (Oct 2026): "past orders / customer cart — back karte hi sab refresh ho raha hai". Order history,
 * the cart review, the payment step and the photo zoom are panels inside ONE page, so the phone's back
 * button skipped past them, left the trade portal and, on return, everything started again from the top.
 *
 * Usage: pass how many panels are open right now and a function that closes the TOP one. While anything
 * is open the page holds one extra browser-history entry (same URL; Next.js state is copied onto it).
 * Back → the top panel closes (and if another is still open, the entry is put back for the next Back).
 * Closing everything with the page's own buttons quietly removes the entry, so history never piles up.
 */
import { useEffect, useRef } from "react";

export function useBackToClose(depth: number, closeTop: () => void) {
  const closeRef = useRef(closeTop);
  closeRef.current = closeTop;
  const pushed = useRef(false);
  const ignore = useRef(0);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const push = () => {
    try { window.history.pushState({ ...(window.history.state ?? {}), bdPanel: true }, ""); pushed.current = true; } catch { /* ignore */ }
  };

  useEffect(() => {
    const onPop = () => {
      if (ignore.current > 0) { ignore.current--; return; }
      if (!pushed.current) return;
      pushed.current = false;   // the browser just removed our entry
      closeRef.current();
      // Another panel still open (or this one refused to close, e.g. mid-upload)? Hold Back again.
      setTimeout(() => { if (depthRef.current > 0 && !pushed.current) push(); }, 80);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (depth > 0 && !pushed.current) push();
    else if (depth === 0 && pushed.current) {
      pushed.current = false;
      if (window.history.state?.bdPanel) { ignore.current++; window.history.back(); }
    }
  }, [depth]);
}
