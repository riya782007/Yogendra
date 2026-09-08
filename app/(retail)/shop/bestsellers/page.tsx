export const dynamic = "force-dynamic";
import { getStorefrontSafe } from "@/lib/supabase/queries";
import { pickBestsellers, pickNewArrivals } from "@/lib/shopCatalog";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "Bestsellers", description: "Blythe Diva’s most-loved jewellery designs." };

export default async function BestsellersPage() {
  const { products, formula } = await getStorefrontSafe();
  const newest = new Set(pickNewArrivals(products, 8).map((p) => p.sku));
  const items = pickBestsellers(products, newest, 48);
  const list = items.length ? items : products.slice(0, 48);
  return <ShopProductGrid title="Bestsellers" subtitle={`${list.length} most-loved designs`} products={list} formula={formula} />;
}
