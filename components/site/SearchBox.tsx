"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "./Icons";

export function SearchBox() {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <>
      {/* Desktop: inline search field */}
      <form
        onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`); }}
        className="hidden sm:flex items-center bg-cream rounded-full px-3 py-1.5">
        <IconSearch className="w-4 h-4 text-ink/50" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search jewellery…"
          className="bg-transparent outline-none text-sm px-2 w-32 focus:w-44 transition-all placeholder:text-ink/40" />
      </form>
      {/* Mobile: search icon button → search page */}
      <button onClick={() => router.push("/search")} aria-label="Search" title="Search"
        className="sm:hidden p-2 rounded-full hover:bg-cream transition-colors"><IconSearch /></button>
    </>
  );
}
