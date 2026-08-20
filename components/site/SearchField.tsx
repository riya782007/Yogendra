"use client";
import { IconSearch } from "./Icons";

/**
 * The search input that lives ON the /search page. The header search only exists on desktop; on a phone
 * the header shows a search ICON that routes here — but this page had no box to type into, so mobile
 * search was dead. Native GET (not client router.push) so it works inside in-app browsers (WhatsApp)
 * even when Next client navigation is flaky.
 */
export function SearchField({ initial = "" }: { initial?: string }) {
  return (
    <form
      action="/search"
      method="get"
      className="flex items-center bg-white border border-sand rounded-full px-4 py-2.5 max-w-xl focus-within:border-emerald transition-colors shadow-card"
    >
      <IconSearch className="w-5 h-5 text-ink/50 shrink-0" />
      <input
        key={initial}
        type="search"
        name="q"
        defaultValue={initial}
        autoFocus
        enterKeyHint="search"
        autoComplete="off"
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
