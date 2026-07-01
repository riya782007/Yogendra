import type { MetadataRoute } from "next";
// Set NEXT_PUBLIC_SITE_URL in Vercel to the final brand domain (e.g. https://blythediva.com).
// Fallback = the stable production alias, never the per-deployment URL.
const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://yogendra-ten.vercel.app").replace(/\/$/, "");
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      // Dealer portal + admin + transactional pages must never be crawled or indexed.
      disallow: ["/admin", "/checkout", "/order", "/trade", "/partner", "/dealer", "/wholesale"],
    }],
    sitemap: `${BASE}/sitemap.xml`,
  };
}
