"use client";
import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Privacy toggle. When ON it blurs every element marked `.sensitive` (revenue, collections, prices,
 * sales figures) so the screen is safe to show in-store. Mounted in the admin layout, but the toggle
 * and blur only apply on the money-heavy pages the owner asked for — Dashboard, Bank & Cash, Sales
 * Records and Purchases — and are hidden everywhere else. Toggle via the floating button OR the
 * keyboard shortcut Ctrl/⌘ + Shift + H. The choice is remembered on this device and synced across tabs.
 */
const PRIVACY_ROUTES = ["/admin/dashboard", "/admin/cashbook", "/admin/sales", "/admin/purchase"];

export function PrivacyShield({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const pathname = usePathname();
  // Prefix match so /admin/purchase and /admin/purchases (list + a single purchase) both count.
  const active = PRIVACY_ROUTES.some((p) => (pathname ?? "").startsWith(p));
  const [hidden, setHidden] = useState(false);

  useEffect(() => { setHidden(typeof window !== "undefined" && localStorage.getItem("bd_privacy") === "1"); }, []);

  const set = (v: boolean) => { setHidden(v); try { localStorage.setItem("bd_privacy", v ? "1" : "0"); } catch { /* private mode */ } };
  const toggle = () => set(!hidden);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "h" || e.key === "H")) {
        e.preventDefault();
        set(localStorage.getItem("bd_privacy") !== "1");
      }
    };
    const onStorage = (e: StorageEvent) => { if (e.key === "bd_privacy") setHidden(e.newValue === "1"); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("storage", onStorage); };
  }, []);

  return (
    <div className={`${className} ${active && hidden ? "privacy-on" : ""}`}>
      {active && (
        <button onClick={toggle} title="Hide / show money figures (Ctrl/⌘ + Shift + H)"
          className="no-print fixed bottom-24 right-5 z-[55] px-4 py-2.5 rounded-full bg-ink text-white text-sm shadow-luxe hover:bg-ink/90 transition-colors flex items-center gap-1.5">
          {hidden ? "🙈 Figures hidden" : "👁 Hide figures"}
          <kbd className="text-[9px] font-sans opacity-60 border border-white/30 rounded px-1 leading-none py-0.5">⌃⇧H</kbd>
        </button>
      )}
      {children}
    </div>
  );
}
