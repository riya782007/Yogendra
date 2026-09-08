export const dynamic = "force-dynamic";
import { getShopSlice } from "@/lib/catalogSlice";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "All Jewellery", description: "Shop the full Blythe Diva collection — Kundan, Meenakari, Temple and more." };

export default async function AllJewelleryPage() {
  const { products, formula } = await getShopSlice({ order: "sku", limit: 48 });
  return <ShopProductGrid title="All Jewellery" products={products} formula={formula} />;
}
