import Link from "next/link";

const LINKS = [
  { href: "/admin/dashboard", label: "Dashboard", icon: "▦" },
  { href: "/admin/upload", label: "Add Inventory", icon: "↑" },
  { href: "/admin/catalogue", label: "Catalogue", icon: "✦" },
  { href: "/admin/categories", label: "Categories", icon: "▦" },
  { href: "/admin/billing", label: "Billing (POS)", icon: "₹" },
  { href: "/admin/estimates", label: "Estimates", icon: "≈" },
  { href: "/admin/returns", label: "Returns", icon: "⤺" },
  { href: "/admin/purchases", label: "Purchases", icon: "⇪" },
  { href: "/admin/inventory", label: "Inventory", icon: "▤" },
  { href: "/admin/approvals", label: "Approvals", icon: "✓" },
  { href: "/admin/inbox", label: "Notifications", icon: "✉" },
  { href: "/admin/roles", label: "Roles", icon: "⚿" },
];
const EXTERNAL = [
  { href: "/shop", label: "Retail store", icon: "🛍" },
  { href: "/wholesale", label: "Wholesale", icon: "📦" },
];

export function AdminNav() {
  return (
    <aside className="no-print w-60 shrink-0 min-h-screen bg-ink text-cream/90 px-4 py-6 flex flex-col">
      <div className="px-2 mb-8">
        <p className="font-display text-2xl text-ivory leading-none">Blythe Diva</p>
        <p className="text-[10px] tracking-[0.25em] uppercase text-gold-light mt-1">Owner Console</p>
      </div>
      <nav className="space-y-1">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}
            className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm hover:bg-white/10 transition-all hover:translate-x-0.5">
            <span className="w-5 text-center text-gold-light">{l.icon}</span>{l.label}
          </Link>
        ))}
      </nav>
      <p className="px-3 mt-7 mb-2 text-[10px] uppercase tracking-widest text-cream/40">Storefront</p>
      <nav className="space-y-1">
        {EXTERNAL.map((l) => (
          <Link key={l.href} href={l.href}
            className="group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-cream/70 hover:bg-white/10 transition-all">
            <span className="w-5 text-center text-gold-light/70">{l.icon}</span>{l.label} <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">↗</span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto px-3 pt-6">
        <div className="flex items-center gap-2 text-[11px] text-cream/50">
          <span className="h-2 w-2 rounded-full bg-emerald-light animate-pulse" /> Live · Sadar Bazar, Delhi
        </div>
      </div>
    </aside>
  );
}
