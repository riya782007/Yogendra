"use client";
import { useEffect, useRef, useState } from "react";

export function AnimatedNumber({ value, prefix = "", suffix = "", duration = 1100, decimals = 0 }: {
  value: number; prefix?: string; suffix?: string; duration?: number; decimals?: number;
}) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const run = () => {
      if (started.current) return;
      started.current = true;
      const to = value;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3); // ease-out; 0→1, never overshoots
        setN(to * eased);
        if (p < 1) requestAnimationFrame(tick);
        else setN(to); // land exactly on the target (no rounding drift)
      };
      requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) run(); }), { threshold: 0.25 });
    io.observe(el);
    // Fallback: if the observer never fires (already on-screen, off-viewport, or flaky),
    // still run so the number can never get stuck at 0.
    const fb = setTimeout(run, 700);
    return () => { io.disconnect(); clearTimeout(fb); };
  }, [value, duration]);
  // Never render a negative (guards the "flash −X" the QA saw) for non-negative targets.
  const safe = value >= 0 ? Math.max(0, n) : n;
  const formatted = safe.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return <span ref={ref} className="count-tabular">{prefix}{formatted}{suffix}</span>;
}
