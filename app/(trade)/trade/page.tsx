export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { TradeLeadPopup } from "@/components/site/TradeLeadPopup";
import { getPricingFormula, getWholesaleOrderHistory, getCategories, getLivePromosCached } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { PromoHero } from "@/components/site/PromoHero";
import { getWholesaleSession } from "@/lib/wholesale";
import { TRADE_PAGE_SIZE, getTradeFacetsCached, getTradeSlice, getTradeSliceCached, type TradeFacet } from "@/lib/catalogSlice";
import { WholesaleCatalog } from "@/components/site/WholesaleCatalog";
import { SellForm } from "@/components/site/SellForm";

export const metadata: Metadata = {
  title: "Dealer Dashboard",
  robots: { index: false, follow: false, nocache: true },
};

const WHOLESALE_MIN = 300000; // ₹3,000 in paise (#27)

async function loadPayInfo() {
  try {
    const { data: pmRows } = await supabaseServer().from("payment_methods").select("name,upi_id,qr_code_url,kind,is_default").eq("active", true);
    const pms = ((pmRows as any[]) ?? []).filter((m) => m.upi_id || m.qr_code_url);
    const upi = pms.find((m) => m.is_default) ?? pms.find((m) => String(m.kind ?? "").toLowerCase().includes("upi")) ?? pms[0] ?? null;
    return upi ? { payeeName: (upi.name as string) ?? "Blythe Diva", upiId: (upi.upi_id as string) ?? null, qrUrl: (upi.qr_code_url as string) ?? null } : null;
  } catch {
    return null;
  }
}

/** First paint: one page of published designs (not the full 4k+ dump, which 500s on Vercel). */
async function loadTradeCatalogSafe() {
  const [formula, slice, payInfo, facets, colourOptions] = await Promise.all([
    getPricingFormula(),
    getTradeSliceCached(0, TRADE_PAGE_SIZE).catch(() => getTradeSlice(0, TRADE_PAGE_SIZE)),
    loadPayInfo(),
    getTradeFacetsCached().catch(() => [] as TradeFacet[]),
    // Catalogue-wide colours for the filter. Cached and tagged like the facets, and never fatal —
    // an empty list just falls back to the colours present in the loaded page.
    getTradeColoursCached().catch(() => [] as string[]),
  ]);
  const minOrder = formula.wholesaleMinOrder ?? WHOLESALE_MIN;
  const minRupees = Math.round(minOrder / 100).toLocaleString("en-IN");
  return { list: slice.list, hasMore: slice.hasMore, facets, colourOptions, minOrder, minRupees, payInfo, wholesaleTiers: formula.wholesaleTiers ?? [] };
}

export default async function TradeDashboard() {
  // OPEN CATALOGUE: guests browse designs + trade rates without an account; ORDERING still needs an
  // approved dealer account, so the owner keeps control of who he sells to.
  const session = await getWholesaleSession();
  const guest = !session;

  const packedP = loadTradeCatalogSafe().catch(() => ({
    list: [] as any[], hasMore: false, facets: [] as TradeFacet[], colourOptions: [] as string[], minOrder: WHOLESALE_MIN, minRupees: "3,000", payInfo: null as any, wholesaleTiers: [] as any[],
  }));
  const historyP = session ? getWholesaleOrderHistory(session.id).catch(() => []) : Promise.resolve([]);
  const promosP = getLivePromosCached("wholesale", "hero").catch(() => []);
  const catsP = session ? getCategories().then((cs) => cs.map((c) => ({ id: c.id, name: c.name }))).catch(() => []) : Promise.resolve([] as { id: string; name: string }[]);
  const dealerP = (async () => {
    if (!session) return null;
    try {
      const { data } = await supabaseServer().from("customers").select("address,pincode").eq("id", session.id).maybeSingle();
      return data;
    } catch { return null; }
  })();

  const [packed, history, promos, categories, dealer] = await Promise.all([packedP, historyP, promosP, catsP, dealerP]);
  const { list, hasMore, facets, colourOptions, minOrder, minRupees, payInfo, wholesaleTiers } = packed;
  const outstanding = (history as any[]).reduce((s, h) => s + Math.max(0, (h.total ?? 0) - (h.amountPaid ?? 0)), 0);

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      {promos.length > 0 && <div className="rounded-2xl overflow-hidden mb-6 shadow-card"><PromoHero promos={promos} /></div>}
      <h1 className="font-display text-4xl text-ink mb-1">Wholesale Catalogue</h1>
      <p className="text-sm text-muted mb-6">Factory-direct trade rates — browse freely and check out directly. ₹{minRupees} minimum order. Your margin vs MRP is shown on every line.</p>
      <WholesaleCatalog products={list} hasMore={!!hasMore} facets={facets} colourOptions={colourOptions} customerName={session?.name ?? "Guest"} customerPhone={session?.phone ?? ""} savedAddress={dealer?.address ?? ""} savedPincode={dealer?.pincode ?? ""} minOrder={minOrder} history={history} payInfo={payInfo} outstanding={outstanding} tiers={wholesaleTiers} guest={guest} />

      {guest && <TradeLeadPopup totalDesigns={list.length} />}

      {session && (
      <section className="mt-12 border-t border-sand pt-8">
        <div className="grid md:grid-cols-2 gap-8 items-start">
          <div>
            <p className="text-gold-dark tracking-[0.2em] uppercase text-xs">Supply to us</p>
            <h2 className="font-display text-3xl text-ink mt-1">Submit your products</h2>
            <p className="text-sm text-muted mt-3">
              Have designs we don&apos;t carry yet? Send them over. Submissions come in under your trade
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
      )}
    </div>
  );
}
