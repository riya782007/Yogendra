"use client";

/** Manual Retry only. Auto-reset on the error boundary remounted forever as "Just a moment / Loading…". */
export function markRetryFresh() {
  try { sessionStorage.removeItem("bd_err_retried"); } catch { /* ignore */ }
}
