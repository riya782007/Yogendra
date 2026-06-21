"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}
      className="hidden sm:flex items-center bg-cream rounded-full px-3 py-1.5">
      <span className="text-ink/50 text-sm">⌕</span>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jewellery…"
        className="bg-transparent outline-none text-sm px-2 w-32 focus:w-44 transition-all placeholder:text-ink/40" />
    </form>
  );
}
