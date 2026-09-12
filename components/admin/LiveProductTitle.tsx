"use client";
import { useEffect, useRef, useState } from "react";

/** Page heading that follows the name field as the owner types or picks a title.
 *  The server H1 used to stay on the previous name until a full refresh — and after
 *  Save, Netlify often re-served the stale RSC payload, so it looked like the rename
 *  never stuck. */
export function LiveProductTitle({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const dirty = useRef(false);
  useEffect(() => {
    const onName = (e: Event) => {
      const next = (e as CustomEvent<string>).detail;
      if (typeof next !== "string" || !next.trim()) return;
      dirty.current = true;
      setName(next);
    };
    window.addEventListener("bd-product-name", onName);
    return () => window.removeEventListener("bd-product-name", onName);
  }, []);
  useEffect(() => { if (!dirty.current) setName(initial); }, [initial]);
  return <h1 className="font-display text-4xl text-ink">{name}</h1>;
}
