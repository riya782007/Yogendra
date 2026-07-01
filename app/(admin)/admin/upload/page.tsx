export const dynamic = "force-dynamic";
import { getCategoryTree, getVariantOptions, getStyles } from "@/lib/supabase/queries";
import { COLOR_CATALOG } from "@/lib/colors";
import { AddInventoryTabs } from "@/components/admin/AddInventoryTabs";

export const metadata = { title: "Owner Console · Upload" };

export default async function UploadPage() {
  // Colours are FIXED from the master catalog (lib/colors.ts) — only approved colours appear, each
  // carries its scanner barcode code, and the picker shows them alphabetically. Size/polish still
  // come from the self-growing master; "Oxidised" is a POLISH/finish, never a colour. The category
  // tree lets a product be filed into a subcategory at creation time.
  const [tree, dbOpts, styleRows] = await Promise.all([
    getCategoryTree(),
    getVariantOptions().catch(() => ({ color: [] as string[], size: [] as string[], polish: [] as string[] })),
    getStyles().catch(() => []),
  ]);
  const variantOptions = {
    color: COLOR_CATALOG.map((c) => c.name),
    size: dbOpts.size ?? [],
    polish: Array.from(new Set([...(dbOpts.polish ?? []), "Oxidised"])).sort((a, b) => a.localeCompare(b)),
  };
  const colorCodes = Object.fromEntries(COLOR_CATALOG.map((c) => [c.name.toLowerCase(), c.code]));
  const categories = tree.map((c) => ({ id: c.id, name: c.name }));
  const subcategories = tree.flatMap((c) => (c.subcategories ?? []).map((s) => ({ id: s.id, name: s.name, categoryId: c.id })));
  const styles = styleRows.map((s) => ({ id: s.id, name: s.name, categoryId: s.category_id ?? "" }));
  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Add Inventory / New Product</h1>
      <p className="text-sm text-muted mb-6">Create a product with variants and publish settings for wholesale &amp; retail. New designs are saved as drafts until you publish. Each colour variant prints a barcode of <code className="bg-cream px-1 rounded">{`{productSKU}-{colourCode}`}</code> from your <a href="/admin/colours" className="text-emerald nav-link">Colours master</a>.</p>
      <AddInventoryTabs
        categories={categories}
        subcategories={subcategories}
        styles={styles}
        variantOptions={variantOptions}
        colorCodes={colorCodes}
      />
    </main>
  );
}
