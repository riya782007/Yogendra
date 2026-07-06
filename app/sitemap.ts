export const dynamic = "force-dynamic";
import type { MetadataRoute } from "next";
import { getSitemapData } from "@/lib/supabase/queries";

const BASE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://yogendra-ten.vercel.app").replace(/\/$/, "");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { products, categories } = await getSitemapData();
  const now = new Date();
  return [
    { url: `${BASE}/shop`, lastModified: now, changeFrequency: "daily", priority: 1 },
    ...categories.map((slug) => ({ url: `${BASE}/shop/c/${slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...products.map((p) => ({ url: `${BASE}/shop/${p.slug}/${p.sku}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
