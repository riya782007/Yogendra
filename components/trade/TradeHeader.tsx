import Link from "next/link";
import { wholesaleLogoutAction } from "@/app/actions/wholesale";

/**
 * TradeHeader — dealer-portal chrome. Deliberately DISTINCT from the retail
 * <Header/>: no category mega-menu, no cart/wishlist, no search. This is a
 * business dashboard, not a shop. Shown only inside the (trade) route group to
 * authenticated dealers.
 */
export function TradeHeader({ dealerName }: { dealerName?: string | null }) {
  const nav = [
    { href: "/trade", label: "Dashboard" },
    { href: "/trade/orders", label: "Orders" },
    { href: "/trade/account", label: "Account" },
  ];
  return (
    <header className="sticky top-0 z-40 bg-ink text-cream border-b border-white/10">
      <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
        <Link href="/trade" className="leading-none">
          <span className="block font-display text-2xl text-ivory tracking-tight">Blythe Diva</span>
          <span className="block text-[9px] tracking-[0.3em] uppercase text-gold-light -mt-1">Trade Portal</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm text-cream/80">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-gold transition-colors py-2">{n.label}</Link>
          ))}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          {dealerName && <span className="hidden sm:inline text-cream/60">{dealerName}</span>}
          <form action={wholesaleLogoutAction}>
            <button className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-gold hover:text-ink transition-colors">Logout</button>
          </form>
        </div>
      </div>
    </header>
  );
}
