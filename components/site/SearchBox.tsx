import Link from "next/link";
import { IconSearch } from "./Icons";

export function SearchBox() {
  return (
    <>
      {/* Desktop: native GET so Enter submits even if client JS is slow (WhatsApp in-app browser). */}
      <form
        action="/search"
        method="get"
        className="hidden sm:flex items-center bg-cream rounded-full px-3 py-1.5">
        <IconSearch className="w-4 h-4 text-ink/50" />
        <input
          type="search"
          name="q"
          placeholder="Search jewellery…"
          enterKeyHint="search"
          autoComplete="off"
          className="bg-transparent outline-none text-sm px-2 w-32 focus:w-44 transition-all placeholder:text-ink/40"
        />
      </form>
      {/* Mobile: search icon → search page */}
      <Link href="/search" aria-label="Search" title="Search"
        className="sm:hidden p-2 rounded-full hover:bg-cream transition-colors"><IconSearch /></Link>
    </>
  );
}
