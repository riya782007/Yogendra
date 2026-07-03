export const dynamic = "force-dynamic";
import { getPricingFormula } from "@/lib/supabase/queries";
import { getSession, can } from "@/lib/auth";
import { savePricingFormulaAction } from "@/app/actions/catalog";
import PricingFormulaEditor from "@/components/admin/PricingFormulaEditor";

export const metadata = { title: "Owner Console · Pricing formula" };

export default async function PricingPage() {
  const canEdit = can(getSession(), "catalog.price_edit");
  const formula = await getPricingFormula();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Pricing formula</h1>
        <p className="mt-1 text-stone-500">
          The <b>base wholesale price</b> you enter on each product is the only pricing input — this formula
          builds the Retail selling price and the MRP from it, exactly like your costing sheet. Purchase-bill
          prices are reference-only and never affect pricing.
        </p>
      </header>

      {canEdit ? (
        <PricingFormulaEditor initial={formula} action={savePricingFormulaAction} />
      ) : (
        <div className="rounded-xl border border-stone-200 bg-stone-50 p-6 text-stone-600">
          You don't have permission to edit pricing. Ask the owner for the <code>catalog.price_edit</code> role.
        </div>
      )}
    </div>
  );
}
