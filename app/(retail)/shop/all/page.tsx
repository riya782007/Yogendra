export const dynamic = "force-dynamic";
import { getStorefrontSafe } from "@/lib/supabase/queries";
import { ShopProductGrid } from "@/components/site/ShopProductGrid";

export const metadata = { title: "All Jewellery", description: "Shop the full Blythe Diva collection — Kundan, Meenakari, Temple and more." };

export default async function AllJewelleryPage() {
  const { products, formula } = await getStorefrontSafe();
  return <ShopProductGrid title="All Jewellery" products={products} formula={formula} />;
}
