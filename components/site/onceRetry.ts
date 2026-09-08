"use client";
import { useEffect, useState } from "react";

const KEY = "bd_err_retried";

/** One automatic retry per tab session — never loop "Loading…" forever when the page keeps failing. */
export function useOnceRetry(reset: () => void): "retrying" | "manual" {
  const [phase, setPhase] = useState<"retrying" | "manual">("manual");
  useEffect(() => {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(KEY) === "1") {
        setPhase("manual");
        return;
      }
      sessionStorage?.setItem(KEY, "1");
      setPhase("retrying");
      const t = setTimeout(() => reset(), 500);
      return () => clearTimeout(t);
    } catch {
      setPhase("manual");
    }
  }, [reset]);
  return phase;
}

export function markRetryFresh() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}
