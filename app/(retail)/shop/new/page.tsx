export const revalidate = 60;
import { getShopSlice } from "@/lib/catalogSlice";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "New Arrivals", description: "The latest Blythe Diva designs, just added to the collection." };

export default async function NewArrivalsPage() {
  const { products, formula } = await getShopSlice({ order: "new" });
  return <ShopProductGrid title="New Arrivals" subtitle={`${products.length} latest designs`} products={products} formula={formula} />;
}
