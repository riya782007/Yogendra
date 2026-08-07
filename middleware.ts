import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const OWNER = process.env.ADMIN_SESSION_TOKEN ?? "bd-owner-session-v1";
const STAFF = OWNER + "-staff";

/** Longest-prefix → required permission(s). An array means ANY of those perms grants access.
 *  Paths not listed are open to any signed-in user. */
const ROUTE_PERM: [string, string | string[]][] = [
  ["/admin/upload", "catalog.create"],
  ["/admin/catalogue", "catalog.view"],
  ["/admin/media", "catalog.ai"],
  ["/admin/categories", "catalog.edit"],
  ["/admin/inventory", "inventory.view"],
  ["/admin/barcodes", "inventory.barcode"],
  ["/admin/reorder", "inventory.view"],
  ["/admin/billing", "billing.sell"],
  ["/admin/sales", "sales.view"],
  // Invoice/estimate detail pages: viewable by sellers OR sales-viewers (so POS->invoice works).
  ["/admin/invoice", ["billing.sell", "billing.gst", "sales.view"]],
  ["/admin/estimate", ["estimates.create", "estimates.bill", "sales.view"]],
  ["/admin/estimates", "estimates.create"],
  ["/admin/returns", "billing.refund"],
  ["/admin/purchases", "purchases.view"],
  ["/admin/purchase", "purchases.view"],
  ["/admin/customers", "customers.view"],
  ["/admin/customer", "customers.view"],
  ["/admin/product", "catalog.view"],
  ["/admin/suppliers", "suppliers.manage"],
  ["/admin/supplier", "suppliers.manage"],
  ["/admin/reviews", "reviews.respond"],
  ["/admin/feedback", "reviews.respond"],
  ["/admin/abandoned", "marketing.manage"],
  ["/admin/reels", "reels.manage"],
  ["/admin/approvals", "approvals.approve"],
  ["/admin/analytics", "analytics.view"],
  ["/admin/roles", "roles.manage"],
];

// Custom subdomains → internal paths. Set TRADE_HOST / ADMIN_HOST in Vercel env when the domain is
// live (e.g. trade.blythediva.com and a private admin-bd.blythediva.com). Until then these defaults
// simply never match the vercel.app host, so nothing changes on the current URL.
const TRADE_HOST = (process.env.TRADE_HOST || "trade.blythediva.com").toLowerCase();
const ADMIN_HOST = (process.env.ADMIN_HOST || "admin-bd.blythediva.com").toLowerCase();

export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") || "").split(":")[0].toLowerCase();

  // Map the subdomain to the section it serves, so trade.blythediva.com shows the wholesale catalogue
  // and the private admin subdomain shows the console — while blythediva.com stays the retail store.
  let path = req.nextUrl.pathname;
  let rewritten = false;
  // Auth pages must stay reachable on the custom subdomains WITHOUT being prefixed — otherwise the
  // admin host rewrites /login → /admin/login, which needs auth, which redirects back to /login…
  // an infinite ERR_TOO_MANY_REDIRECTS loop. Keep /login (and its assets) un-prefixed.
  const isAuthPath = path === "/login" || path.startsWith("/login/");
  if (host === TRADE_HOST && !path.startsWith("/trade") && !isAuthPath) {
    path = "/trade" + (path === "/" ? "" : path); rewritten = true;
  } else if (host === ADMIN_HOST && !path.startsWith("/admin") && !isAuthPath) {
    path = "/admin" + (path === "/" ? "" : path); rewritten = true;
  }
  // Keep the sections apart: the trade subdomain must never expose /admin, and vice-versa.
  if (host === TRADE_HOST && path.startsWith("/admin")) {
    const url = req.nextUrl.clone(); url.pathname = "/trade"; url.search = ""; return NextResponse.redirect(url);
  }
  if (host === ADMIN_HOST && path.startsWith("/trade")) {
    const url = req.nextUrl.clone(); url.pathname = "/admin/dashboard"; url.search = ""; return NextResponse.redirect(url);
  }
  const pass = () => {
    if (!rewritten) return NextResponse.next();
    const u = req.nextUrl.clone(); u.pathname = path; return NextResponse.rewrite(u);
  };

  // ---- TRADE (wholesale) portal ----------------------------------------------------------
  if (path === "/trade" || path.startsWith("/trade/")) {
    // NO DEALER PORTAL (owner: "remove the login entirely, no friction"). The catalogue is fully open
    // and anyone can check out directly. /trade needs no cookie. The remaining logged-in-only sub-pages
    // (account, orders, line-sheet) simply fall back to the open catalogue instead of a sign-in wall.
    if (path === "/trade") return pass();
    const dealer = req.cookies.get("bd_wholesale")?.value;
    if (!dealer) {
      const url = req.nextUrl.clone();
      url.pathname = "/trade";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return pass();
  }

  // ---- ADMIN console -----------------------------------------------------------------------
  if (path === "/admin" || path.startsWith("/admin/")) {
    const session = req.cookies.get("bd_session")?.value;
    const authed = session === OWNER || session === STAFF;
    if (!authed) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
    // Owner → unrestricted.
    if (session === OWNER) return pass();

    // Staff → enforce route permission.
    const perms = (req.cookies.get("bd_perms")?.value ?? "").split(",").filter(Boolean);
    const match = ROUTE_PERM.filter(([p]) => path === p || path.startsWith(p + "/")).sort((a, b) => b[0].length - a[0].length)[0];
    if (match) {
      const required = Array.isArray(match[1]) ? match[1] : [match[1]];
      const ok = required.some((r) => perms.includes(r));
      if (!ok) {
        const url = req.nextUrl.clone();
        url.pathname = "/admin/dashboard";
        url.searchParams.set("denied", match[0].replace("/admin/", ""));
        return NextResponse.redirect(url);
      }
    }
    return pass();
  }

  // Keep a signed-in DEALER on the trade portal and off the D2C storefront. This used to live in the
  // retail layout via getWholesaleSession(), but that read a cookie (+ a DB lookup) on EVERY storefront
  // page, which forced every page to render dynamically (no edge cache = slow). Doing it here — a
  // cookie-only check at the edge, no DB — lets the storefront pages be statically cached and load fast.
  // A retail shopper never has this cookie; a stale/invalid one just lands on the open /trade catalogue.
  if (!rewritten && !isAuthPath && req.cookies.get("bd_wholesale")?.value) {
    const url = req.nextUrl.clone(); url.pathname = "/trade"; url.search = ""; return NextResponse.redirect(url);
  }

  // Everything else (retail store, shop pages) — public, plus any subdomain rewrite.
  return pass();
}

// Runs on all page routes (needed for host-based subdomain routing); skips Next internals, static
// files and API routes so those are never rewritten.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"] };
