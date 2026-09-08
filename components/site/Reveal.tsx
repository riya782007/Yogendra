"use client";
import { useEffect, useRef, useState } from "react";

export function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) { setShown(true); return; }
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(true); return;
    }
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }), { threshold: 0.01, rootMargin: "280px 0px" });
    io.observe(el);
    // Fail-open: never leave jewellery cards invisible if IntersectionObserver never fires
    // (slow hydration, some iOS/Safari cases) — that looked like "nothing popping up".
    const t = window.setTimeout(() => setShown(true), 800);
    return () => { io.disconnect(); clearTimeout(t); };
  }, []);
  return (
    <div ref={ref} className={`reveal ${shown ? "is-visible" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}
