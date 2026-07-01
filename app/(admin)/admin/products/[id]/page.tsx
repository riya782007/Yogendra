export const dynamic = "force-dynamic";
import { notFound, redirect } from "next/navigation";
import { getProductForPim } from "@/lib/supabase/queries";
import { requirePerm } from "@/lib/auth";
import { ProductManager } from "@/components/admin/ProductManager";

export const metadata = { title: "Owner Console · Product Management" };

export default async function ProductManagePage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } }) {
  if (!(await requirePerm("catalog.view"))) redirect("/admin/dashboard?denied=products");
  const data = await getProductForPim(params.id);
  if (!data) notFound();
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <ProductManager data={data as any} initialTab={searchParams.tab} />
    </main>
  );
}
