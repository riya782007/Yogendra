export const dynamic = "force-dynamic";
import Link from "next/link";
import { getStorefront } from "@/lib/supabase/queries";
import { computePrices, formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { Reveal } from "@/components/site/Reveal";
import { Back } from "@/components/site/Back";

const MOQ = 6;
const COLLAPSE_VARIANTS = true;

export const metadata = { title: "Wholesale — Trade Pricing for Retailers" };

export default async function Wholesale({ searchParams }: { searchParams: { approved?: string } }) {
  const approved = searchParams.approved === "1";
  const { products, formula } = await getStorefront();
  const totalValue = products.reduce((s, p) => s + computePrices(p.base_wholesale, formula).wholesaleRate * p.qty, 0);

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      <div className="mb-3"><Back label="Back to store" /></div>

      <section className="rounded-3xl bg-ink text-cream px-8 py-12 relative overflow-hidden mb-8">
        <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 15% 20%, #C8A24C, transparent 38%), radial-gradient(circle at 85% 90%, #0F5C4D, transparent 42%)" }} />
        <div className="relative max-w-2xl">
          <p className="text-gold-light tracking-[0.3em] uppercase text-xs">Blythe Diva · Trade</p>
          <h1 className="font-display text-5xl mt-2">Wholesale Catalogue</h1>
          <p className="text-cream/70 mt-3">Factory-direct rates from Sadar Bazar. Mix designs, hit MOQ {MOQ}, and reorder bestsellers in one place — with live stock you can trust.</p>
          <div className="flex flex-wrap gap-6 mt-6 text-sm">
            <span><b className="text-gold-light">{products.length}</b> designs live</span>
            <span><b className="text-gold-light">{formatPaise(totalValue)}</b> stock on hand</span>
            <span><b className="text-gold-light">MOQ {MOQ}</b> pcs</span>
          </div>
        </div>
      </section>

      {!approved && (
        <Reveal>
          <div className="mb-8 rounded-2xl bg-emerald-mist border border-emerald/20 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="font-medium text-emerald-dark">Trade pricing unlocks after owner approval.</p>
              <p className="text-emerald-dark/70 text-sm">Every retailer account is verified before wholesale rates are shown — protecting your margins.</p>
            </div>
            <Link href="/wholesale?approved=1" className="btn-gold px-6 py-3 text-sm font-medium whitespace-nowrap">Enter as approved retailer (demo)</Link>
          </div>
        </Reveal>
      )}

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr>
              <th className="p-4 font-medium">Design</th><th className="p-4 font-medium">SKU</th><th className="p-4 font-medium">Category</th>
              <th className="p-4 font-medium">Live stock</th><th className="p-4 font-medium">MOQ</th><th className="p-4 font-medium text-right">Wholesale rate</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const w = computePrices(p.base_wholesale, formula);
              const low = p.qty > 0 && p.qty <= 3;
              return (
                <tr key={p.id} className="border-t border-sand/60 hover:bg-cream/50 transition-colors">
                  <td className="p-3"><div className="flex items-center gap-3"><div className="w-11 h-13 rounded-lg overflow-hidden"><ProductImage name={p.name} /></div><span className="text-ink font-medium">{p.name}</span></div></td>
                  <td className="p-4 text-muted">{p.sku}{!COLLAPSE_VARIANTS && p.type === "configurable" ? " +colours" : ""}</td>
                  <td className="p-4 text-muted">{p.category.name}</td>
                  <td className="p-4">{p.qty > 0 ? <span className={low ? "text-rose font-medium" : "text-emerald"}>{p.qty} pcs{low ? " · low" : ""}</span> : <span className="text-muted">Out</span>}</td>
                  <td className="p-4">{MOQ}</td>
                  <td className="p-4 text-right font-semibold">{approved ? <span className="text-emerald-dark">{formatPaise(w.wholesaleRate)}</span> : <span className="text-muted">🔒 approval needed</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted mt-4">Colour variants are collapsed per SKU in trade view (configurable). Prices recalculate instantly when the owner updates the pricing formula.</p>
    </div>
  );
}
