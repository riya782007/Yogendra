export const revalidate = 60;
import { getShopSliceCached } from "@/lib/catalogSlice";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "New Arrivals", description: "The latest Blythe Diva designs, just added to the collection." };

// Sept 2026: this called getShopSlice with no limit and no cache, so opening "New Arrivals" re-read the
// ENTIRE published catalogue (plus a variants and an images row per product) live, then rendered every
// one of them into a single grid. That blew past Netlify's 10s function limit and showed the error
// boundary. A "new arrivals" page only ever wants the newest designs, so cap it — and use the cached
// slice, which any product edit still busts instantly via the "storefront" tag.
const LIMIT = 240;

export default async function NewArrivalsPage() {
  const { products, formula } = await getShopSliceCached({ order: "new", limit: LIMIT });
  return <ShopProductGrid title="New Arrivals" subtitle={`${products.length} latest designs`} products={products} formula={formula} />;
}
