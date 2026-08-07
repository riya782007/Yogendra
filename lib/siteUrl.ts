/**
 * Absolute URL to the PUBLIC storefront (blythediva.com), for links shown inside the admin console.
 * The admin runs on its own subdomain (admin-bd.blythediva.com); a RELATIVE "/shop/…" link there stays
 * on the admin host, which the middleware rewrites to "/admin/shop/…" → 404. Building storefront links
 * against this absolute base makes "View on store" always land on the real shop.
 * Set NEXT_PUBLIC_SITE_URL to https://blythediva.com in Vercel (already configured).
 */
// `||` (not `??`) so an env set to an EMPTY string still falls back to the real domain — otherwise SITE
// becomes "" and links like `${SITE}/catalog` turn into a relative "/catalog", which on the admin/trade
// subdomain gets rewritten to /admin|/trade + /catalog → 404 (the "Share Catalogue 404" bug).
export const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blythediva.com").replace(/\/$/, "");

/** Absolute storefront URL: storeUrl("/shop/necklaces/SUKN5585") → https://blythediva.com/shop/... */
export const storeUrl = (path: string) => `${SITE}${path.startsWith("/") ? "" : "/"}${path}`;
