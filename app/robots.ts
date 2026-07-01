import type { MetadataRoute } from "next";
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://yogendra-ry342315-6737s-projects.vercel.app";
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
