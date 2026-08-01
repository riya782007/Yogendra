export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { TradeLeadPopup } from "@/components/site/TradeLeadPopup";
import { getPricingFormula, getWholesaleOrderHistory, getCategories, getActivePromotions } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { PromoHero } from "@/components/site/PromoHero";
import { resolvePrices, overridesOf } from "@/lib/pricing";
import { getWholesaleSession } from "@/lib/wholesale";
import { GST_RATE } from "@/lib/business";
import { WholesaleCatalog } from "@/components/site/WholesaleCatalog";
import { SellForm } from "@/components/site/SellForm";

export const metadata: Metadata = {
  title: "Dealer Dashboard",
  robots: { index: false, follow: false, nocache: true },
};

const WHOLESALE_MIN = 300000; // ₹3,000 in paise (#27)

/**
 * PERFORMANCE — the dealer catalogue is this shop's main-income page, so opening it must be fast.
 * The heavy work below (all published designs + 12k+ colour variants + every cover image +
 * subcategory/style names + payment details) is IDENTICAL for every visitor and doesn't depend on who
 * is signed in — yet it used to re-run on every single page open. It's now wrapped in a shared cache
 * that runs once every few minutes and is reused across all dealers, so a page open is near-instant.
 * Per-dealer data (their session + order history) stays live below and is NOT cached. When the owner
 * edits the catalogue the change appears within the revalidate window (a couple of minutes).
 */
const loadTradeCatalog = unstable_cache(
  async () => {
    const sb = supabaseServer();
    const formula = await getPricingFormula();
    const minOrder = formula.wholesaleMinOrder ?? WHOLESALE_MIN; // configurable in /admin/pricing
    const minRupees = Math.round(minOrder / 100).toLocaleString("en-IN");

    // LEAN CATALOGUE READ (ROOT FIX): fetch ONLY the small columns the dealer panel needs — never the big
    // generated_content JSON. Selecting "*" over ~4.5k products pulled megabytes of description/SEO JSON
    // per page and started TIMING OUT; the pager swallows a failed page as empty, so getStorefront
    // returned nothing and the whole catalogue showed "No designs match". This light select is fast and
    // safe. Published only; hide retail-only lines (wholesale-only designs stay visible for dealers).
    const products: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data } = await sb.from("products")
        .select("id,sku,name,qty,base_wholesale,wholesale_override,retail_override,mrp_override,thumbnail_path,default_variant_id,subcategory_id,style_id,updated_at,created_at,more_designs,more_designs_note,retail_only, category:categories(name)")
        .eq("status", "published").order("sku").range(from, from + 999);
      const raw = (data as any[]) ?? [];
      products.push(...raw.filter((p) => !p.retail_only));
      if (raw.length < 1000) break;
    }

    // NEVER CACHE AN EMPTY CATALOGUE. There are always published designs, so zero rows means the read
    // failed (DB restricted / transient error) — throwing here stops unstable_cache from storing the empty
    // result. Otherwise a one-off failure poisons the cache and the panel stays blank until it's busted by
    // hand (exactly what happened during the egress outage). On a throw the page just retries next request,
    // so it self-heals the moment the database is reachable again.
    if (products.length === 0) throw new Error("trade catalogue: product read returned no rows — not caching");

    // ROTATION: the most recently added / published / edited design shows at the TOP, so the panel
    // always looks freshly stocked. Driven by products.updated_at; created_at is the fallback.
    const touchedAt = (p: any) => new Date(p.updated_at ?? p.created_at ?? 0).getTime();
    const rotated = [...products].sort((a, b) => touchedAt(b) - touchedAt(a));

    // "More designs" note now comes straight off the lean select (no extra query).
    const moreBy = new Map<string, string | null>(products.filter((p) => p.more_designs).map((p) => [p.id as string, (p.more_designs_note as string) ?? null]));

    // Cover images — page through ALL of them (past PostgREST's 1000-row cap) so no design is dropped
    // just because its image sat beyond the first 1000 rows.
    const imgBy = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data: imgRows } = await sb.from("product_images").select("product_id,path,sort").order("product_id", { ascending: true }).range(from, from + 999);
      const rows = ((imgRows as any[]) ?? []);
      for (const r of rows.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
        if (typeof r.path === "string" && r.path.startsWith("http") && !imgBy.has(r.product_id)) imgBy.set(r.product_id, r.path);
      }
      if (rows.length < 1000) break;
    }

    // Variants (colours): a wholesale buyer orders specific colours, so configurable designs are
    // expanded into one orderable row PER colour. Page through ALL variants (12k+ rows), then group.
    const varsBy = new Map<string, any[]>();
    for (let from = 0; ; from += 1000) {
      const { data: vRows } = await sb.from("variants").select("product_id,sku,color,qty,image_paths").order("product_id", { ascending: true }).range(from, from + 999);
      const rows = (vRows as any[]) ?? [];
      for (const v of rows) { const a = varsBy.get(v.product_id) ?? []; a.push(v); varsBy.set(v.product_id, a); }
      if (rows.length < 1000) break;
    }

    // Subcategory ("type") + style names for the dealer-panel filters.
    const [{ data: subRows }, { data: styleRows }] = await Promise.all([
      sb.from("subcategories").select("id,name"),
      sb.from("styles").select("id,name"),
    ]);
    const subName = new Map(((subRows as any[]) ?? []).map((x) => [x.id, x.name]));
    const styleName = new Map(((styleRows as any[]) ?? []).map((x) => [x.id, x.name]));

    // Dealer prices are shown GST-INCLUSIVE (imitation jewellery = 3%) — the rate shown is all-in.
    const gstInc = (paise: number) => Math.round(paise * (1 + GST_RATE / 100));

    const list = rotated.flatMap((p) => {
      const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
      const price = gstInc(ps.wholesaleRate);
      const tp = (p as any).thumbnail_path;
      const parentImg = (typeof tp === "string" && tp.startsWith("http")) ? tp : (imgBy.get((p as any).id) ?? null);
      const pid = (p as any).id as string;
      const allVs = varsBy.get(pid) ?? [];
      const sub = subName.get((p as any).subcategory_id) ?? null;
      const style = styleName.get((p as any).style_id) ?? null;
      if (allVs.length > 0) {
        // Only offer colours actually IN STOCK; drop a design when every colour is out.
        const vs = allVs.filter((v) => (v.qty ?? 0) > 0);
        return vs.map((v) => {
          const vImgs = Array.isArray(v.image_paths) ? v.image_paths.filter((x: string) => typeof x === "string" && x.startsWith("http")) : [];
          const images = vImgs.length ? vImgs : (parentImg ? [parentImg] : []);
          return {
            pid, sku: v.sku, name: p.name, category: p.category.name, sub, style, colour: v.color ?? null,
            qty: v.qty ?? 0, price, mrp: ps.mrp,
            image: images[0] ?? parentImg, images,
            moreDesigns: moreBy.has(pid), moreDesignsNote: moreBy.get(pid) ?? null,
          };
        });
      }
      if ((p.qty ?? 0) <= 0) return [];
      return [{ pid, sku: p.sku, name: p.name, category: p.category.name, sub, style, colour: null, qty: p.qty, price, mrp: ps.mrp, image: parentImg, images: parentImg ? [parentImg] : [], moreDesigns: moreBy.has(pid), moreDesignsNote: moreBy.get(pid) ?? null }];
    })
    // A shareable catalogue must LOOK good — never show a photo-less design.
    .filter((r) => typeof r.image === "string" && r.image.startsWith("http"));

    // Owner's UPI collection details for direct QR payment.
    const { data: pmRows } = await sb.from("payment_methods").select("name,upi_id,qr_code_url,kind,is_default").eq("active", true);
    const pms = ((pmRows as any[]) ?? []).filter((m) => m.upi_id || m.qr_code_url);
    const upi = pms.find((m) => m.is_default) ?? pms.find((m) => String(m.kind ?? "").toLowerCase().includes("upi")) ?? pms[0] ?? null;
    const payInfo = upi ? { payeeName: (upi.name as string) ?? "Blythe Diva", upiId: (upi.upi_id as string) ?? null, qrUrl: (upi.qr_code_url as string) ?? null } : null;

    const wholesaleTiers = formula.wholesaleTiers ?? [];
    return { list, minOrder, minRupees, payInfo, wholesaleTiers };
  },
  ["trade-catalog-v2"],
  { revalidate: 180, tags: ["trade-catalog"] },
);

export default async function TradeDashboard() {
  // OPEN CATALOGUE: guests browse designs + trade rates without an account; ORDERING still needs an
  // approved dealer account, so the owner keeps control of who he sells to.
  const session = await getWholesaleSession();
  const guest = !session;

  // Heavy shared catalogue — cached (see loadTradeCatalog). Near-instant on repeat opens.
  const { list, minOrder, minRupees, payInfo, wholesaleTiers } = await loadTradeCatalog();

  // Per-dealer, always live (never cached).
  const history = session ? await getWholesaleOrderHistory(session.id).catch(() => []) : [];
  const outstanding = (history as any[]).reduce((s, h) => s + Math.max(0, (h.total ?? 0) - (h.amountPaid ?? 0)), 0);
  const promos = await getActivePromotions("wholesale").catch(() => []);
  const categories = session ? (await getCategories()).map((c) => ({ id: c.id, name: c.name })) : [];

  // Dealer's saved delivery address — prefills the ship-to fields at checkout so a COD order always
  // carries a shippable address (owner: "a COD order must be accepted with complete address record").
  const dealer = session
    ? await supabaseServer().from("customers").select("address,pincode").eq("id", session.id).maybeSingle().then((r) => r.data as any).catch(() => null)
    : null;

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      {promos.length > 0 && <div className="rounded-2xl overflow-hidden mb-6 shadow-card"><PromoHero promos={promos} /></div>}
      <h1 className="font-display text-4xl text-ink mb-1">Wholesale Catalogue</h1>
      <p className="text-sm text-muted mb-6">Factory-direct trade rates — browse freely and check out directly. ₹{minRupees} minimum order. Your margin vs MRP is shown on every line.</p>
      <WholesaleCatalog products={list} customerName={session?.name ?? "Guest"} customerPhone={session?.phone ?? ""} savedAddress={dealer?.address ?? ""} savedPincode={dealer?.pincode ?? ""} minOrder={minOrder} history={history} payInfo={payInfo} outstanding={outstanding} tiers={wholesaleTiers} guest={guest} />

      {/* Guests are asked for their details only after they've actually browsed — see TradeLeadPopup. */}
      {guest && <TradeLeadPopup totalDesigns={list.length} />}

      {/* Trade partners can offer their own designs for us to stock (hidden from guests). */}
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
