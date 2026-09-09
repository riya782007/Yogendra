/**
 * Products with no category fall back to the "all" slug (see app/(admin)/admin/catalogue/page.tsx),
 * so the admin "View ↗" button built /shop/all/<sku>. Next.js matches the STATIC "all" segment
 * (shop/all/page.tsx) before the dynamic [category] one, and that folder has no [sku] child — so the
 * URL 404'd. This route reuses the real product page with the category pinned to "all".
 */
import type { Metadata } from "next";
import ProductPage, { generateMetadata as productMetadata } from "../../[category]/[sku]/page";

export const revalidate = 300;

type Params = { params: { sku: string } };

export function generateMetadata({ params }: Params): Promise<Metadata> {
  return productMetadata({ params: { category: "all", sku: params.sku } });
}

export default function AllCategoryProductPage({ params }: Params) {
  return ProductPage({ params: { category: "all", sku: params.sku } });
}
