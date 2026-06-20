import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { getCategories } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function WholesaleLayout({ children }: { children: React.ReactNode }) {
  const categories = (await getCategories()).map((c) => ({ name: c.name, slug: c.slug }));
  return (
    <div className="min-h-screen flex flex-col bg-ivory">
      <Header categories={categories} />
      <main className="flex-1">{children}</main>
      <Footer categories={categories} />
    </div>
  );
}
