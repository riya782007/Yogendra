export const revalidate = 60;
import { getShopSliceCached } from "@/lib/catalogSlice";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "Bestsellers", description: "Blythe Diva’s most-loved jewellery designs." };

// Sept 2026: same fix as /shop/new — this read the whole catalogue live on every view and rendered all
// of it, which exceeded Netlify's 10s function limit. Ordered by stock movement and capped; the cached
// slice is refreshed by any product edit through the "storefront" tag.
const LIMIT = 240;

export default async function BestsellersPage() {
  const { products, formula } = await getShopSliceCached({ order: "qty", limit: LIMIT });
  return <ShopProductGrid title="Bestsellers" subtitle={`${products.length} most-loved designs`} products={products} formula={formula} />;
}
