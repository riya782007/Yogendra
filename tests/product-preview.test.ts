import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The public product page 404s anything a customer must not see — an unpublished draft, or a
 * design whose every colour is out of stock. That is correct, but it meant the owner's "View ↗"
 * button in the catalogue 404'd on exactly the products he most needs to look at.
 *
 * /admin/preview/<sku> renders the same page with that gate lifted, behind the staff session.
 * The whole safety of that rests on ONE property: the preview flag can never come from the URL.
 * These tests hold that line — a regression here would quietly publish every unfinished design.
 */

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
/** Strip comments — the prose explaining this rule must not be mistaken for the code doing it. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PRODUCT_PAGE = read("app/(retail)/shop/[category]/[sku]/page.tsx");
const PRODUCT_CODE = code(PRODUCT_PAGE);
const PREVIEW_ROUTE = read("app/(admin)/admin/preview/[sku]/page.tsx");

describe("the storefront product page still hides what customers must not see", () => {
  it("keeps the 404 for unpublished or sold-out products", () => {
    expect(PRODUCT_PAGE).toMatch(/if\s*\(\s*!preview\s*&&\s*!publiclyVisible\s*\)\s*notFound\(\)/);
  });

  it("treats a product as publicly visible only when published AND in stock", () => {
    expect(PRODUCT_PAGE).toMatch(/publiclyVisible\s*=\s*\(p as any\)\.status === "published" && availableQty > 0/);
  });
});

describe("preview can never be switched on from a URL", () => {
  it("reads the flag from the props object, not from searchParams", () => {
    expect(PRODUCT_PAGE).toMatch(/const preview = \(props as \{ preview\?: boolean \}\)\.preview === true/);
  });

  it("never derives preview from searchParams or params", () => {
    // Either would let a customer append ?preview=1 and read every unpublished design.
    expect(PRODUCT_CODE).not.toMatch(/searchParams[^\n]*preview/i);
    expect(PRODUCT_CODE).not.toMatch(/params[.\[][^\n]*preview/i);
  });

  it("does not accept searchParams at all on the product page", () => {
    // Accepting searchParams would also opt the page out of ISR, undoing the storefront caching.
    expect(PRODUCT_CODE).not.toMatch(/searchParams/);
  });
});

describe("the preview route is staff-only", () => {
  it("checks the session before rendering anything", () => {
    expect(PREVIEW_ROUTE).toMatch(/getSession\(\)/);
    expect(PREVIEW_ROUTE).toMatch(/if \(!session\.authed \|\| !can\(session, "catalog\.view"\)\) notFound\(\)/);
  });

  it("renders per request, so a preview is never cached and served to a shopper", () => {
    expect(PREVIEW_ROUTE).toMatch(/export const dynamic = "force-dynamic"/);
  });

  it("lives under /admin, so the console's own auth and host rewrite apply", () => {
    // The middleware maps the admin subdomain onto /admin/*; a preview outside that tree would
    // be reachable on the public host.
    expect(PREVIEW_ROUTE).toContain("/admin/catalogue");
  });

  it("passes preview in code rather than from the request", () => {
    expect(PREVIEW_ROUTE).toMatch(/preview:\s*true/);
  });
});
