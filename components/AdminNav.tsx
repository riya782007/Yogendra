"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions/auth";

type L = { href: string; label: string; icon: string; perm?: string };
type Perms = string[] | "*";
const GROUPS: { title: string; links: L[] }[] = [
  { title: "Overview", links: [
    { href: "/admin/dashboard", label: "Dashboard", icon: "▦" },
    { href: "/admin/analytics", label: "Analytics & SEO", icon: "◷", perm: "analytics.view" },
  ]},
  { title: "Catalog", links: [
    { href: "/admin/upload", label: "Add Inventory", icon: "↑", perm: "catalog.create" },
    { href: "/admin/submissions", label: "Submissions", icon: "📥", perm: "catalog.create" },
    { href: "/admin/catalogue", label: "Catalogue", icon: "✦", perm: "catalog.view" },
    { href: "/admin/media", label: "Product Photos", icon: "▣", perm: "catalog.ai" },
    { href: "/admin/categories", label: "Categories", icon: "▦", perm: "catalog.edit" },
    { href: "/admin/colours", label: "Colours & Options", icon: "◧", perm: "catalog.edit" },
    { href: "/admin/pricing", label: "Pricing formula", icon: "％", perm: "catalog.price_edit" },
    { href: "/admin/inventory", label: "Inventory", icon: "▤", perm: "inventory.view" },
    { href: "/admin/stock-movements", label: "Stock Movement", icon: "⇅", perm: "inventory.view" },
    { href: "/admin/barcodes", label: "Barcodes", icon: "▥", perm: "inventory.barcode" },
    { href: "/admin/reorder", label: "AI Reorder", icon: "✨", perm: "inventory.view" },
  ]},
  { title: "Sales & Billing", links: [
    { href: "/admin/billing", label: "Billing (POS)", icon: "₹", perm: "billing.sell" },
    { href: "/admin/sales", label: "Sales Records", icon: "❑", perm: "sales.view" },
    { href: "/admin/estimates", label: "Estimates", icon: "≈", perm: "estimates.create" },
    { href: "/admin/returns", label: "Returns", icon: "⤺", perm: "billing.refund" },
    { href: "/admin/purchases", label: "Purchases", icon: "⇪", perm: "purchases.view" },
    { href: "/admin/cashbook", label: "Bank & Cash", icon: "₹", perm: "analytics.view" },
  ]},
  { title: "People", links: [
    { href: "/admin/customers", label: "Customers", icon: "♚", perm: "customers.view" },
    { href: "/admin/suppliers", label: "Suppliers", icon: "⚒", perm: "suppliers.manage" },
    { href: "/admin/reviews", label: "Reviews", icon: "★", perm: "reviews.respond" },
    { href: "/admin/abandoned", label: "Abandoned carts", icon: "⊘", perm: "marketing.manage" },
  ]},
  { title: "Growth", links: [
    { href: "/admin/reels", label: "Reels", icon: "▷", perm: "reels.manage" },
  ]},
  { title: "Control", links: [
    { href: "/admin/approvals", label: "Approvals", icon: "✓", perm: "approvals.approve" },
    { href: "/admin/inbox", label: "Notifications", icon: "✉" },
    { href: "/admin/roles", label: "Roles", icon: "⚿", perm: "roles.manage" },
  ]},
];
const EXTERNAL: L[] = [
  { href: "/shop", label: "Retail store", icon: "🛍" },
  { href: "/wholesale", label: "Wholesale", icon: "📦" },
  { href: "/catalog", label: "Share Catalogue", icon: "📤" },
];

const allow = (perms: Perms, perm?: string) => !perm || perms === "*" || perms.includes(perm);

function NavInner({ collapsed, onNavigate, perms }: { collapsed: boolean; onNavigate?: () => void; perms: Perms }) {
  const path = usePathname();
  const isActive = (href: string) => path === href || path.startsWith(href + "/");
  const groups = GROUPS.map((g) => ({ ...g, links: g.links.filter((l) => allow(perms, l.perm)) })).filter((g) => g.links.length > 0);
  return (
    <>
      <nav className="space-y-4">
        {groups.map((g) => (
          <div key={g.title}>
            {!collapsed && <p className="px-3 mb-1 text-[10px] uppercase tracking-widest text-cream/35">{g.title}</p>}
            <div className="space-y-0.5">
              {g.links.map((l) => (
                <Link key={l.href} href={l.href} onClick={onNavigate} title={collapsed ? l.label : undefined}
                  className={`group flex items-center gap-3 rounded-xl text-sm transition-all ${collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5 hover:translate-x-0.5"} ${isActive(l.href) ? "bg-white/15 text-ivory" : "text-cream/85 hover:bg-white/10"}`}>
                  <span className="w-5 text-center text-gold-light shrink-0">{l.icon}</span>
                  {!collapsed && <span className="truncate">{l.label}</span>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-6">
        {!collapsed && <p className="px-3 mb-1 text-[10px] uppercase tracking-widest text-cream/35">Storefront</p>}
        <div className="space-y-0.5">
          {EXTERNAL.map((l) => (
            <Link key={l.href} href={l.href} target="_blank" onClick={onNavigate} title={collapsed ? l.label : undefined}
              className={`group flex items-center gap-3 rounded-xl text-sm text-cream/70 hover:bg-white/10 transition-all ${collapsed ? "justify-center py-2.5" : "px-3 py-2.5"}`}>
              <span className="w-5 text-center text-gold-light/70 shrink-0">{l.icon}</span>
              {!collapsed && <><span className="truncate">{l.label}</span><span className="ml-auto opacity-0 group-hover:opacity-100">↗</span></>}
            </Link>
          ))}
        </div>
      </div>
      <form action={logoutAction} className="mt-6">
        <button className={`w-full text-sm text-cream/70 hover:text-white transition-colors ${collapsed ? "text-center" : "text-left px-3"}`} title="Sign out">{collapsed ? "↩" : "↩ Sign out"}</button>
      </form>
    </>
  );
}

export function AdminNav({ perms = "*", roleName = "Owner" }: { perms?: Perms; roleName?: string }) {
  const [open, setOpen] = useState(false);       // mobile drawer
  const [collapsed, setCollapsed] = useState(false); // desktop rail
  const path = usePathname();

  useEffect(() => { try { setCollapsed(localStorage.getItem("bd_nav_collapsed") === "1"); } catch {} }, []);
  useEffect(() => { setOpen(false); }, [path]); // close drawer on navigation
  function toggleCollapsed() { setCollapsed((c) => { const n = !c; try { localStorage.setItem("bd_nav_collapsed", n ? "1" : "0"); } catch {} return n; }); }

  return (
    <>
      {/* Mobile top bar */}
      <header className="no-print lg:hidden fixed top-0 inset-x-0 h-14 bg-ink text-cream z-40 flex items-center gap-3 px-4 shadow-card">
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="flex flex-col gap-[5px] p-1">
          <span className="block h-0.5 w-6 bg-cream rounded" /><span className="block h-0.5 w-6 bg-cream rounded" /><span className="block h-0.5 w-6 bg-cream rounded" />
        </button>
        <p className="font-display text-xl text-ivory leading-none">Blythe Diva</p>
        <span className="ml-auto text-[10px] tracking-widest uppercase text-gold-light">{roleName}</span>
      </header>

      {/* Mobile drawer + overlay */}
      {open && <div className="no-print lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setOpen(false)} />}
      <aside className={`no-print lg:hidden fixed top-0 left-0 bottom-0 w-72 bg-ink text-cream/90 z-50 px-4 py-6 overflow-y-auto transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center justify-between mb-6 px-2">
          <div>
            <p className="font-display text-2xl text-ivory leading-none">Blythe Diva</p>
            <p className="text-[10px] tracking-[0.25em] uppercase text-gold-light mt-1">Owner Console</p>
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="text-cream/70 text-xl px-2">✕</button>
        </div>
        <NavInner collapsed={false} onNavigate={() => setOpen(false)} perms={perms} />
      </aside>

      {/* Desktop sidebar — sticky & self-scrolling, independent of the page scroll */}
      <aside className={`no-print hidden lg:flex shrink-0 lg:sticky lg:top-0 h-screen bg-ink text-cream/90 px-3 py-6 flex-col transition-[width] duration-200 ${collapsed ? "w-[4.75rem]" : "w-60"}`}>
        <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
          {!collapsed && <div>
            <p className="font-display text-2xl text-ivory leading-none">Blythe Diva</p>
            <p className="text-[10px] tracking-[0.25em] uppercase text-gold-light mt-1">{roleName === "Owner" ? "Owner Console" : roleName}</p>
          </div>}
          <button onClick={toggleCollapsed} aria-label="Collapse menu" className="text-cream/60 hover:text-white text-lg px-1">{collapsed ? "»" : "«"}</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NavInner collapsed={collapsed} perms={perms} />
        </div>
        {!collapsed && (
          <div className="px-3 pt-4">
            <div className="flex items-center gap-2 text-[11px] text-cream/50">
              <span className="h-2 w-2 rounded-full bg-emerald-light animate-pulse" /> Live · Sadar Bazar, Delhi
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
