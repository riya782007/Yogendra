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

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // ---- TRADE (wholesale) portal ----------------------------------------------------------
  // Completely separate auth domain from /admin. Dealers carry a `bd_wholesale` cookie set by
  // wholesaleLoginAction. Every /trade route is protected EXCEPT the login screen. This is the
  // first, cheap gate (cookie presence); the authoritative approved-dealer check runs in each
  // page via getWholesaleSession(). Note: an admin's bd_session does NOT grant trade access.
  if (path === "/trade" || path.startsWith("/trade/")) {
    if (path === "/trade/login") return NextResponse.next();
    const dealer = req.cookies.get("bd_wholesale")?.value;
    if (!dealer) {
      const url = req.nextUrl.clone();
      url.pathname = "/trade/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // ---- ADMIN console -----------------------------------------------------------------------
  const session = req.cookies.get("bd_session")?.value;
  const authed = session === OWNER || session === STAFF;
  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Owner → unrestricted.
  if (session === OWNER) return NextResponse.next();

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
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/trade/:path*"] };
