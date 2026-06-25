"use client";
import { useState, useEffect } from "react";

/**
 * #10/#25 — Privacy toggle. Wraps the dashboard; when ON it blurs every element
 * marked `.sensitive` (revenue, collections, sales figures) so the screen is safe
 * to show in-store. The choice is remembered on this device.
 */
export function PrivacyShield({ children }: { children: React.ReactNode }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => { setHidden(typeof window !== "undefined" && localStorage.getItem("bd_privacy") === "1"); }, []);
  function toggle() {
    setHidden((h) => { const n = !h; try { localStorage.setItem("bd_privacy", n ? "1" : "0"); } catch {} return n; });
  }
  return (
    <div className={hidden ? "privacy-on" : ""}>
      <button onClick={toggle} title="Hide/show money figures"
        className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-full bg-ink text-white text-sm shadow-luxe hover:bg-ink/90 transition-colors">
        {hidden ? "🙈 Figures hidden — Show" : "👁 Hide figures"}
      </button>
      {children}
    </div>
  );
}
