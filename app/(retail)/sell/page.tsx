export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { getCategories } from "@/lib/supabase/queries";
import { Back } from "@/components/site/Back";
import { SellForm } from "@/components/site/SellForm";

export const metadata: Metadata = {
  title: "Sell with us — Submit your jewellery to Blythe Diva",
  description: "Have jewellery to sell? Submit your products to Blythe Diva. Our team reviews every piece and gets in touch about stocking it in our retail and wholesale store.",
};

export default async function SellPage() {
  const categories = (await getCategories()).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div className="max-w-3xl mx-auto px-5 py-8">
      <div className="mb-3"><Back label="Back to store" /></div>

      <section className="rounded-3xl bg-ink text-cream px-6 sm:px-8 py-10 relative overflow-hidden mb-8">
        <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 15% 20%, #C8A24C, transparent 38%), radial-gradient(circle at 85% 90%, #0F5C4D, transparent 42%)" }} />
        <div className="relative max-w-2xl">
          <p className="text-gold-light tracking-[0.3em] uppercase text-xs">Blythe Diva · Sell with us</p>
          <h1 className="font-display text-4xl sm:text-5xl mt-2 leading-tight">Submit your jewellery</h1>
          <p className="text-cream/70 mt-3">
            Designer, reseller or maker? Send us your pieces. We review every submission and reach out about
            pricing and stocking it across our retail storefront and wholesale network.
          </p>
        </div>
      </section>

      <div className="grid sm:grid-cols-3 gap-3 mb-8 text-center">
        {[
          { n: "1", t: "Submit", d: "Share photos, price & details below." },
          { n: "2", t: "We review", d: "Our buying team evaluates the piece." },
          { n: "3", t: "Go live", d: "Approved pieces are listed for sale." },
        ].map((s) => (
          <div key={s.n} className="bg-white rounded-2xl border border-sand p-4">
            <div className="w-8 h-8 mx-auto grid place-items-center rounded-full bg-emerald-mist text-emerald-dark font-semibold">{s.n}</div>
            <p className="font-medium text-ink mt-2">{s.t}</p>
            <p className="text-xs text-muted mt-0.5">{s.d}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-card p-6 sm:p-8 border border-sand">
        <SellForm categories={categories} channel="retail" />
      </div>
    </div>
  );
}
