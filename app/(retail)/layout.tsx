import { redirect } from "next/navigation";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Assistant } from "@/components/site/Assistant";
import { getCategoryTreeCached, getLivePromosCached } from "@/lib/supabase/queries";
import { getWholesaleSession } from "@/lib/wholesale";
import { CartProvider } from "@/components/cart/CartContext";
import { WishlistProvider } from "@/components/wishlist/WishlistContext";
import { PromoPopup } from "@/components/site/PromoPopup";
import { RetailLeadPopup } from "@/components/site/RetailLeadPopup";
import { WhatsAppFab } from "@/components/site/WhatsAppFab";

export const dynamic = "force-dynamic";

export default async function RetailLayout({ children }: { children: React.ReactNode }) {
  // #24: a signed-in dealer is kept off the D2C storefront — route them to the trade portal.
  if (await getWholesaleSession()) redirect("/trade");
  const tree = await getCategoryTreeCached();
  const cats = tree.map((c) => ({ name: c.name, slug: c.slug, subcategories: c.subcategories.map((s) => ({ name: s.name, slug: s.slug })) }));
  const [popupList, stripList] = await Promise.all([
    getLivePromosCached("retail", "popup").catch(() => []),
    getLivePromosCached("retail", "strip").catch(() => []),
  ]);
  const popup = popupList[0] ?? null;
  const promoMessages = stripList.map((s: any) => (s.headline || s.title || "").trim()).filter(Boolean);
  return (
    <CartProvider><WishlistProvider><div className="min-h-screen flex flex-col bg-ivory">
      <Header categories={cats} promoMessages={promoMessages} />
      <main className="flex-1">{children}</main>
      <Footer categories={cats} />
      <Assistant />
      <PromoPopup promo={popup as any} />
      <RetailLeadPopup />
      <WhatsAppFab />
    </div></WishlistProvider></CartProvider>
  );
}
