export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStorefront, getWholesaleOrderHistory, getCategories, getActivePromotions } from "@/lib/supabase/queries";
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

export default async function TradeDashboard() {
  // Authoritative gate: only an approved, signed-in dealer may see trade pricing.
  const session = await getWholesaleSession();
  if (!session) redirect("/trade/login");

  const { products, formula } = await getStorefront({ includeWholesaleOnly: true, excludeRetailOnly: true });
  const minOrder = formula.wholesaleMinOrder ?? WHOLESALE_MIN; // configurable in /admin/pricing
  const minRupees = Math.round(minOrder / 100).toLocaleString("en-IN");

  // First real photo per product (dealers must see the actual piece).
  const sb = supabaseServer();
  const { data: imgRows } = await sb.from("product_images").select("product_id,path,sort");
  const imgBy = new Map<string, string>();
  for (const r of ((imgRows as any[]) ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    if (typeof r.path === "string" && r.path.startsWith("http") && !imgBy.has(r.product_id)) imgBy.set(r.product_id, r.path);
  }
  // Variants (colours): a wholesale buyer orders specific colours, so configurable designs are
  // expanded into one orderable row PER colour (its own SKU + stock); simple products stay single.
  // PAGE through ALL variants (12k+ rows, past PostgREST's 1000-row cap). We deliberately do NOT filter
  // by .in(product_id, pIds): 741 UUIDs overflow the request URL length and the query silently returns
  // nothing — which made every design fall back to the "no colours" branch (the "variants nahi aa rahe"
  // bug). Fetch all, ordered for stable paging, then group by product_id.
  const varsBy = new Map<string, any[]>();
  for (let from = 0; ; from += 1000) {
    const { data: vRows } = await sb.from("variants").select("product_id,sku,color,qty,image_paths").order("product_id", { ascending: true }).range(from, from + 999);
    const rows = (vRows as any[]) ?? [];
    for (const v of rows) { const a = varsBy.get(v.product_id) ?? []; a.push(v); varsBy.set(v.product_id, a); }
    if (rows.length < 1000) break;
  }

  // Subcategory ("type") + style names for the dealer-panel filters (client point 14).
  const [{ data: subRows }, { data: styleRows }] = await Promise.all([
    sb.from("subcategories").select("id,name"),
    sb.from("styles").select("id,name"),
  ]);
  const subName = new Map(((subRows as any[]) ?? []).map((x) => [x.id, x.name]));
  const styleName = new Map(((styleRows as any[]) ?? []).map((x) => [x.id, x.name]));

  // Dealer prices are shown GST-INCLUSIVE (imitation jewellery = 3%), so the rate the dealer sees is
  // the final all-in price. The charged order total is grossed up by the same GST in the order action,
  // so "price shown" == "amount paid".
  const gstInc = (paise: number) => Math.round(paise * (1 + GST_RATE / 100));

  const list = (products as any[]).flatMap((p) => {
    const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
    const price = gstInc(ps.wholesaleRate);
    // Use getStorefront's already-resolved cover (it pages through all images) so a design is never
    // dropped just because the capped product_images fetch missed it.
    const parentImg = ((p as any).image as string | null) ?? imgBy.get((p as any).id) ?? null;
    const pid = (p as any).id as string;
    const allVs = varsBy.get(pid) ?? [];
    const sub = subName.get((p as any).subcategory_id) ?? null;
    const style = styleName.get((p as any).style_id) ?? null;
    if (allVs.length > 0) {
      // A wholesale catalogue has to be shareable: only offer colours that are actually IN STOCK
      // (sold-out colours are the owner's "hidden variants"), and drop a design entirely when every
      // colour is out of stock. Colours of the same design are grouped into one dropdown row client-side.
      const vs = allVs.filter((v) => (v.qty ?? 0) > 0);
      return vs.map((v) => {
        // ALL of the colour's photos (e.g. a model shot AND a stand shot of the same colour) so the
        // dealer sees every angle — not just the first image.
        const vImgs = Array.isArray(v.image_paths) ? v.image_paths.filter((x: string) => typeof x === "string" && x.startsWith("http")) : [];
        const images = vImgs.length ? vImgs : (parentImg ? [parentImg] : []);
        return {
          pid, sku: v.sku, name: p.name, category: p.category.name, sub, style, colour: v.color ?? null,
          qty: v.qty ?? 0, price, mrp: ps.mrp,
          image: images[0] ?? parentImg, images,
        };
      });
    }
    // Simple product (no colours): list it only when it has stock.
    if ((p.qty ?? 0) <= 0) return [];
    return [{ pid, sku: p.sku, name: p.name, category: p.category.name, sub, style, colour: null, qty: p.qty, price, mrp: ps.mrp, image: parentImg, images: parentImg ? [parentImg] : [] }];
  })
  // A shareable wholesale catalogue must LOOK good — never show a photo-less design (letter placeholder),
  // it drives dealers away. Only list rows that actually have a real image.
  .filter((r) => typeof r.image === "string" && r.image.startsWith("http"));

  // Owner's UPI collection details for direct QR payment (no Razorpay → owner keeps 100%).
  const { data: pmRows } = await sb.from("payment_methods").select("name,upi_id,qr_code_url,kind,is_default").eq("active", true);
  const pms = ((pmRows as any[]) ?? []).filter((m) => m.upi_id || m.qr_code_url);
  const upi = pms.find((m) => m.is_default) ?? pms.find((m) => String(m.kind ?? "").toLowerCase().includes("upi")) ?? pms[0] ?? null;
  const payInfo = upi ? { payeeName: (upi.name as string) ?? "Blythe Diva", upiId: (upi.upi_id as string) ?? null, qrUrl: (upi.qr_code_url as string) ?? null } : null;

  const history = await getWholesaleOrderHistory(session.id).catch(() => []);
  // What this dealer still owes across their recent wholesale orders (transparency + gentle nudge).
  const outstanding = (history as any[]).reduce((s, h) => s + Math.max(0, (h.total ?? 0) - (h.amountPaid ?? 0)), 0);
  const categories = (await getCategories()).map((c) => ({ id: c.id, name: c.name }));
  const promos = await getActivePromotions("wholesale").catch(() => []);

  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      {promos.length > 0 && <div className="rounded-2xl overflow-hidden mb-6 shadow-card"><PromoHero promos={promos} /></div>}
      <h1 className="font-display text-4xl text-ink mb-1">Dealer Dashboard</h1>
      <p className="text-sm text-muted mb-6">Factory-direct trade rates. Enter quantities and place your order — ₹{minRupees} minimum. Your margin vs MRP is shown on every line.</p>
      <WholesaleCatalog products={list} customerName={session.name} minOrder={minOrder} history={history} payInfo={payInfo} outstanding={outstanding} tiers={formula.wholesaleTiers ?? []} />

      {/* Trade partners can offer their own designs for us to stock. */}
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
    </div>
  );
}
