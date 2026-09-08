export const dynamic = "force-dynamic";
import { getStorefrontSafe } from "@/lib/supabase/queries";
import { pickNewArrivals } from "@/lib/shopCatalog";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "New Arrivals", description: "The latest Blythe Diva designs, just added to the collection." };

export default async function NewArrivalsPage() {
  const { products, formula } = await getStorefrontSafe();
  const items = pickNewArrivals(products, 48);
  return <ShopProductGrid title="New Arrivals" subtitle={`${items.length} latest designs`} products={items} formula={formula} />;
}
