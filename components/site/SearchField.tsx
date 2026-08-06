"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconSearch } from "./Icons";

/**
 * The search input that lives ON the /search page. The header search only exists on desktop; on a phone
 * the header shows a search ICON that routes here — but this page had no box to type into, so mobile
 * search was dead. This field fixes that: it works on every device and comes pre-filled with the current
 * query so shoppers can refine it.
 */
export function SearchField({ initial = "" }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); const t = q.trim(); router.push(t ? `/search?q=${encodeURIComponent(t)}` : "/search"); }}
      className="flex items-center bg-white border border-sand rounded-full px-4 py-2.5 max-w-xl focus-within:border-emerald transition-colors shadow-card"
    >
      <IconSearch className="w-5 h-5 text-ink/50 shrink-0" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
        placeholder="Search designs, colours, categories…"
        className="bg-transparent outline-none text-base px-3 flex-1 placeholder:text-ink/40"
        aria-label="Search jewellery"
      />
      <button type="submit" className="rounded-full bg-emerald text-white text-sm font-medium px-4 py-1.5 hover:bg-emerald-dark shrink-0">
        Search
      </button>
    </form>
  );
}
