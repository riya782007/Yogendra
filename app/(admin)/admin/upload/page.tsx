export const dynamic = "force-dynamic";
import { getCategories, getVariantOptions, getColorCodeMap } from "@/lib/supabase/queries";
import { AddInventoryTabs } from "@/components/admin/AddInventoryTabs";

export const metadata = { title: "Owner Console · Upload" };

export default async function UploadPage() {
  // Same suggestion pool the Catalogue Variants tab uses — so an owner adding variants
  // at upload time gets the same colour/size/polish autocomplete, and any new values
  // they type are remembered for next time (variant_options auto-grows). Plus the
  // colour-code map so the variant editor can preview the printed barcode live.
  const [categories, variantOptions, colorCodes] = await Promise.all([
    getCategories(),
    getVariantOptions().catch(() => ({ color: [], size: [], polish: [] })),
    getColorCodeMap().catch(() => ({} as Record<string, string>)),
  ]);
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Add Inventory / New Product</h1>
      <p className="text-sm text-muted mb-6">Create a product with variants and publish settings for wholesale &amp; retail. New designs are saved as drafts until you publish. Each colour variant prints a barcode of <code className="bg-cream px-1 rounded">{`{productSKU}-{colourCode}`}</code> from your <a href="/admin/colours" className="text-emerald nav-link">Colours master</a>.</p>
      <AddInventoryTabs
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        variantOptions={variantOptions}
        colorCodes={colorCodes}
      />
    </main>
  );
}
