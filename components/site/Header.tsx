import Link from "next/link";
import { PromoBar } from "./PromoBar";
import { MobileMenu } from "./MobileMenu";
import { CartWidget } from "@/components/cart/CartWidget";
import { SearchBox } from "./SearchBox";
import { WishlistWidget } from "@/components/wishlist/WishlistWidget";
import { IconUser } from "./Icons";

type Cat = { name: string; slug: string; subcategories?: { name: string; slug: string }[] };

export function Header({ categories }: { categories: Cat[] }) {
  return (
    <header className="sticky top-0 z-40">
      <PromoBar />
      <div className="bg-ivory/95 backdrop-blur border-b border-sand/70">
        <div className="max-w-7xl mx-auto px-5 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <MobileMenu categories={categories} />
            <Link href="/shop" className="leading-none">
              <span className="block font-display text-2xl md:text-3xl text-ink tracking-tight">Blythe Diva</span>
              <span className="hidden md:block text-[9px] tracking-[0.3em] uppercase text-gold-dark -mt-1">Artificial Jewellery</span>
            </Link>
          </div>

          <nav className="hidden md:flex items-center gap-7 text-sm text-ink/80">
            <div className="relative group">
              <button className="nav-link py-2">Shop by Category</button>
              <div className="absolute left-1/2 -translate-x-1/2 top-full pt-3 opacity-0 invisible translate-y-1 group-hover:opacity-100 group-hover:visible group-hover:translate-y-0 transition-all duration-200">
                <div className="bg-white rounded-2xl shadow-luxe p-4 grid grid-cols-2 gap-x-5 gap-y-3 w-[460px] border border-sand/60 max-h-[70vh] overflow-y-auto">
                  {categories.map((c) => (
                    <div key={c.slug} className="min-w-0">
                      <Link href={`/shop/c/${c.slug}`}
                        className="block px-3 py-1.5 rounded-lg font-medium text-ink hover:bg-emerald-mist hover:text-emerald transition-colors truncate">
                        {c.name}
                      </Link>
                      {c.subcategories && c.subcategories.length > 0 && (
                        <div className="pl-3 mt-0.5 space-y-0.5">
                          {c.subcategories.map((s) => (
                            <Link key={s.slug} href={`/shop/c/${c.slug}?sub=${s.slug}`}
                              className="block px-2 py-1 rounded text-xs text-muted hover:text-emerald hover:bg-cream transition-colors truncate">
                              {s.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  <Link href="/shop" className="px-3 py-2 rounded-lg text-gold-dark font-medium hover:bg-cream col-span-2">View all designs →</Link>
                </div>
              </div>
            </div>
            <Link href="/shop?sort=new" className="nav-link py-2">New Arrivals</Link>
            <Link href="/shop?sort=bestseller" className="nav-link py-2">Bestsellers</Link>
            <Link href="/reels" className="nav-link py-2">Reels</Link>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 text-ink">
            <SearchBox />
            <Link href="/account" aria-label="Track order / Account" title="Track order"
              className="hidden sm:grid place-items-center p-2 rounded-full hover:bg-cream hover:text-emerald transition-colors"><IconUser /></Link>
            <WishlistWidget />
            <CartWidget />
          </div>
        </div>
      </div>
    </header>
  );
}
