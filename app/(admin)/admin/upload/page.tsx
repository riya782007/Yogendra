export const dynamic = "force-dynamic";
import { getCategories, getVariantOptions } from "@/lib/supabase/queries";
import { UploadClient } from "@/components/admin/UploadClient";

export const metadata = { title: "Owner Console · Upload" };

export default async function UploadPage() {
  // Same suggestion pool the Catalogue Variants tab uses — so an owner adding
  // variants at upload time gets the same colour/size/polish autocomplete, and any
  // new values they type are remembered for next time (server action upserts into
  // variant_options).
  const [categories, variantOptions] = await Promise.all([
    getCategories(),
    getVariantOptions().catch(() => ({ color: [], size: [], polish: [] })),
  ]);
  return (
    <main className="p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Add Inventory</h1>
      <p className="text-sm text-muted mb-6">Category first, then designs — single or bulk. New designs go live on the storefront instantly.</p>
      <UploadClient
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        variantOptions={variantOptions}
      />
    </main>
  );
}
