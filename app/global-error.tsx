"use client";

/** Last-resort boundary for root-layout failures (must render its own html/body). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, background: "#faf7f2", color: "#2b2430" }}>
        <div style={{ textAlign: "center", maxWidth: 360, padding: 24 }}>
          <div style={{ fontSize: 40 }}>😕</div>
          <h2 style={{ margin: "8px 0 4px" }}>Something went wrong</h2>
          <p style={{ fontSize: 14, color: "#7a7280", margin: 0 }}>Please try again — this is usually temporary.</p>
          <button onClick={() => reset()} style={{ marginTop: 16, padding: "10px 22px", borderRadius: 999, border: "none", background: "#2b2430", color: "#fff", fontSize: 14, cursor: "pointer" }}>Retry</button>
        </div>
      </body>
    </html>
  );
}
