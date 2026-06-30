import { redirect } from "next/navigation";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Assistant } from "@/components/site/Assistant";
import { getCategoryTree } from "@/lib/supabase/queries";
import { getWholesaleSession } from "@/lib/wholesale";
import { CartProvider } from "@/components/cart/CartContext";
import { WishlistProvider } from "@/components/wishlist/WishlistContext";

export const dynamic = "force-dynamic";

export default async function RetailLayout({ children }: { children: React.ReactNode }) {
  // #24: a signed-in wholesaler is kept off the D2C storefront — route them to trade pricing.
  if (await getWholesaleSession()) redirect("/wholesale");
  const tree = await getCategoryTree();
  const cats = tree.map((c) => ({ name: c.name, slug: c.slug, subcategories: c.subcategories.map((s) => ({ name: s.name, slug: s.slug })) }));
  return (
    <CartProvider><WishlistProvider><div className="min-h-screen flex flex-col bg-ivory">
      <Header categories={cats} />
      <main className="flex-1">{children}</main>
      <Footer categories={cats} />
      <Assistant />
    </div></WishlistProvider></CartProvider>
  );
}
