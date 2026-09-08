"use client";

import { useEffect } from "react";

/** Last-resort boundary for root-layout failures (must render its own html/body). One retry only. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      if (sessionStorage.getItem("bd_err_retried") === "1") return;
      sessionStorage.setItem("bd_err_retried", "1");
      const t = setTimeout(() => reset(), 500);
      return () => clearTimeout(t);
    } catch { /* ignore */ }
  }, [reset]);
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#faf7f2", color: "#2b2430" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
          <div style={{ fontSize: 40 }}>💎</div>
          <h2 style={{ margin: "8px 0 4px" }}>Just a moment</h2>
          <p style={{ fontSize: 14, color: "#7a7280", margin: 0 }}>Please try again — this is usually temporary.</p>
          <button onClick={() => { try { sessionStorage.removeItem("bd_err_retried"); } catch {} reset(); }} style={{ marginTop: 16, padding: "10px 22px", borderRadius: 999, border: "none", background: "#2b2430", color: "#fff", fontSize: 14, cursor: "pointer" }}>Retry</button>
        </div>
      </body>
    </html>
  );
}
