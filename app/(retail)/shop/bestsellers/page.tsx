export const dynamic = "force-dynamic";
import { getShopSlice } from "@/lib/catalogSlice";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "Bestsellers", description: "Blythe Diva’s most-loved jewellery designs." };

export default async function BestsellersPage() {
  const { products, formula } = await getShopSlice({ order: "qty", limit: 48 });
  return <ShopProductGrid title="Bestsellers" subtitle={`${products.length} most-loved designs`} products={products} formula={formula} />;
}
