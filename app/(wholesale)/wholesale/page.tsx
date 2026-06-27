export const dynamic = "force-dynamic";
import { getStorefront, getWholesaleOrderHistory, getCategories } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { resolvePrices, overridesOf, formatPaise } from "@/lib/pricing";
import { Back } from "@/components/site/Back";
import { getWholesaleSession } from "@/lib/wholesale";
import { wholesaleLoginAction } from "@/app/actions/wholesale";
import { WholesaleCatalog } from "@/components/site/WholesaleCatalog";
import { SellForm } from "@/components/site/SellForm";

export const metadata = { title: "Wholesale — Trade Pricing for Retailers" };
const WHOLESALE_MIN = 300000; // ₹3,000 in paise (#27)

export default async function Wholesale({ searchParams }: { searchParams: { error?: string } }) {
  const session = await getWholesaleSession();
  const { products, formula } = await getStorefront({ includeWholesaleOnly: true });

  // Logged in & approved → real wholesale catalog with ordering.
  if (session) {
    // First real photo per product (wholesalers must see the actual piece).
    const sb = supabaseServer();
    const { data: imgRows } = await sb.from("product_images").select("product_id,path,sort");
    const imgBy = new Map<string, string>();
    for (const r of ((imgRows as any[]) ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
      if (typeof r.path === "string" && r.path.startsWith("http") && !imgBy.has(r.product_id)) imgBy.set(r.product_id, r.path);
    }
    const list = products.map((p) => {
      const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
      return {
        sku: p.sku, name: p.name, category: p.category.name, qty: p.qty,
        price: ps.wholesaleRate, mrp: ps.mrp, image: imgBy.get((p as any).id) ?? null,
      };
    });
    const history = await getWholesaleOrderHistory(session.id).catch(() => []);
    const categories = (await getCategories()).map((c) => ({ id: c.id, name: c.name }));
    return (
      <div className="max-w-7xl mx-auto px-5 py-8">
        <div className="mb-4"><Back label="Back to store" /></div>
        <h1 className="font-display text-4xl text-ink mb-1">Wholesale Catalogue</h1>
        <p className="text-sm text-muted mb-6">Factory-direct trade rates. Enter quantities and place your order — ₹3,000 minimum. Your margin vs MRP is shown on every line.</p>
        <WholesaleCatalog products={list} customerName={session.name} minOrder={WHOLESALE_MIN} history={history} />

        {/* Trade partners can offer their own designs for us to stock. */}
        <section className="mt-12 border-t border-sand pt-8">
          <div className="grid md:grid-cols-2 gap-8 items-start">
            <div>
              <p className="text-gold-dark tracking-[0.2em] uppercase text-xs">Supply to us</p>
              <h2 className="font-display text-3xl text-ink mt-1">Submit your products</h2>
              <p className="text-sm text-muted mt-3">
                Have designs we don't carry yet? Send them over. Submissions come in under your trade
                account, our buying team reviews each piece, and approved designs are added to the catalogue.
              </p>
              <ul className="mt-4 space-y-2 text-sm text-ink/75">
                <li className="flex gap-2"><span className="text-emerald">✓</span> Linked to your verified trade account</li>
                <li className="flex gap-2"><span className="text-emerald">✓</span> Set your asking price &amp; quantity</li>
                <li className="flex gap-2"><span className="text-emerald">✓</span> Nothing goes live until we approve it</li>
              </ul>
            </div>
            <div className="bg-white rounded-2xl shadow-card p-6 border border-sand">
              <SellForm categories={categories} channel="wholesale" defaultName={session.name} lockedContact />
            </div>
          </div>
        </section>
      </div>
    );
  }

  const totalValue = products.reduce((s, p) => s + resolvePrices(p.base_wholesale, formula, overridesOf(p)).wholesaleRate * p.qty, 0);

  // Not logged in → trade login + value prop.
  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <div className="mb-3"><Back label="Back to store" /></div>
      <section className="rounded-3xl bg-ink text-cream px-6 sm:px-8 py-10 sm:py-12 relative overflow-hidden mb-8">
        <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 15% 20%, #C8A24C, transparent 38%), radial-gradient(circle at 85% 90%, #0F5C4D, transparent 42%)" }} />
        <div className="relative max-w-2xl">
          <p className="text-gold-light tracking-[0.3em] uppercase text-xs">Blythe Diva · Trade</p>
          <h1 className="font-display text-4xl sm:text-5xl mt-2 leading-tight break-words">Wholesale Portal</h1>
          <p className="text-cream/70 mt-3">Factory-direct rates from Sadar Bazar. {products.length} designs live · {formatPaise(totalValue)} stock on hand. Approved retailers sign in to see trade prices and order.</p>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <form action={wholesaleLoginAction} className="bg-white rounded-2xl shadow-card p-7 border border-sand">
          <h2 className="font-display text-2xl text-ink mb-1">Retailer sign in</h2>
          <p className="text-xs text-muted mb-5">Use the phone number and access code your supplier gave you.</p>
          <input name="phone" placeholder="Registered phone number" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald mb-3" />
          <input name="code" placeholder="Access code" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald uppercase tracking-widest" />
          {searchParams.error && <p className="text-sm text-rose mt-2">Wrong phone or code, or your account isn't approved yet.</p>}
          <button className="btn-primary w-full mt-4 py-3 text-sm font-medium">Sign in to trade prices</button>
        </form>

        <div className="bg-emerald-mist/60 rounded-2xl p-7 border border-emerald/20">
          <h2 className="font-display text-2xl text-emerald-dark mb-2">Become a wholesale partner</h2>
          <p className="text-sm text-emerald-dark/80">Trade pricing is unlocked only after we verify your shop — this protects everyone's margins. To get an access code, message us with your shop name and GST number:</p>
          <a href="https://wa.me/919873151767" target="_blank" rel="noopener" className="btn-gold inline-block px-6 py-3 text-sm font-medium mt-4">Request access on WhatsApp</a>
        </div>
      </div>
    </div>
  );
}
