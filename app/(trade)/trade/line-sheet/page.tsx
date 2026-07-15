export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getStorefront } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { resolvePrices, overridesOf, formatPaise } from "@/lib/pricing";
import { getWholesaleSession } from "@/lib/wholesale";
import { GST_RATE } from "@/lib/business";
import { LineSheetToolbar } from "@/components/site/LineSheetToolbar";

export const metadata: Metadata = {
  title: "Wholesale Line-Sheet",
  robots: { index: false, follow: false, nocache: true },
};

type Row = { sku: string; name: string; category: string; colours: string[]; qty: number; price: number; mrp: number; image: string | null };

export default async function LineSheet() {
  const session = await getWholesaleSession();
  if (!session) redirect("/trade/login");

  const { products, formula } = await getStorefront({ includeWholesaleOnly: true, excludeRetailOnly: true });
  const tiers = [...(formula.wholesaleTiers ?? [])].sort((a, b) => a.minQty - b.minQty);

  const sb = supabaseServer();
  const { data: imgRows } = await sb.from("product_images").select("product_id,path,sort");
  const imgBy = new Map<string, string>();
  for (const r of ((imgRows as any[]) ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
    if (typeof r.path === "string" && r.path.startsWith("http") && !imgBy.has(r.product_id)) imgBy.set(r.product_id, r.path);
  }
  const pIds = (products as any[]).map((p) => (p as any).id).filter(Boolean);
  const { data: vRows } = pIds.length
    ? await sb.from("variants").select("product_id,color,qty,image_paths").in("product_id", pIds)
    : { data: [] as any[] };
  const varsBy = new Map<string, any[]>();
  for (const v of ((vRows as any[]) ?? [])) { const a = varsBy.get(v.product_id) ?? []; a.push(v); varsBy.set(v.product_id, a); }

  // One row per design (colours listed together — a compact buyer's line-sheet, not per-variant).
  // Shareable sheet: only IN-STOCK colours, prices GST-inclusive, and sold-out designs dropped.
  const gstInc = (paise: number) => Math.round(paise * (1 + GST_RATE / 100));
  const rows: Row[] = (products as any[]).flatMap((p) => {
    const ps = resolvePrices(p.base_wholesale, formula, overridesOf(p));
    const vs = varsBy.get((p as any).id) ?? [];
    const hasVariants = vs.length > 0;
    const inStock = vs.filter((v) => (v.qty ?? 0) > 0);
    const stock = hasVariants ? inStock.reduce((s, v) => s + (v.qty ?? 0), 0) : (p.qty ?? 0);
    if (stock <= 0) return [];
    const colours = Array.from(new Set(inStock.map((v) => v.color).filter(Boolean))) as string[];
    const vImg = inStock.map((v) => (Array.isArray(v.image_paths) ? v.image_paths.find((x: string) => typeof x === "string" && x.startsWith("http")) : null)).find(Boolean) ?? null;
    return [{ sku: p.sku, name: p.name, category: p.category.name, colours, qty: stock, price: gstInc(ps.wholesaleRate), mrp: ps.mrp, image: imgBy.get((p as any).id) ?? vImg }];
  })
  // Never print a photo-less design on the shareable line-sheet.
  .filter((r) => typeof r.image === "string" && r.image.startsWith("http"));

  const today = new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="max-w-5xl mx-auto px-5 py-6 print:py-0 print:px-0">
      <LineSheetToolbar count={rows.length} />

      <style>{`@media print { @page { margin: 12mm; } .sheet-card { break-inside: avoid; } a[href]:after { content: ""; } }`}</style>

      <header className="mb-5 flex items-end justify-between border-b border-ink/10 pb-3">
        <div>
          <h1 className="font-display text-3xl text-ink">BlytheDIVA — Wholesale Line-Sheet</h1>
          <p className="text-sm text-muted">Trade rates for {session.name} · {today}</p>
        </div>
        <p className="text-xs text-muted text-right">Prices are wholesale, incl. GST.<br />MRP shown for your margin reference.</p>
      </header>

      {tiers.length > 0 && (
        <p className="mb-4 text-sm text-emerald-dark">
          Bulk savings: {tiers.map((t) => `${t.minQty}+ pcs save ${t.pctOff}%`).join(" · ")} (per design, applied at checkout).
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {rows.map((r) => {
          const margin = r.mrp - r.price;
          const marginPct = r.mrp > 0 ? Math.round((margin / r.mrp) * 100) : 0;
          return (
            <div key={r.sku} className="sheet-card rounded-xl border border-sand bg-white overflow-hidden">
              <div className="aspect-[4/5] bg-cream">
                {r.image ? <img src={r.image} alt={r.name} className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-xs text-muted">No photo</div>}
              </div>
              <div className="p-2.5">
                <p className="text-sm font-medium text-ink leading-tight">{r.name}</p>
                <p className="text-[11px] text-muted font-mono">{r.sku} · {r.category}</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-semibold text-emerald-dark">{formatPaise(r.price)}</span>
                  <span className="text-[11px] text-muted line-through">{formatPaise(r.mrp)}</span>
                </div>
                <p className="text-[11px] text-gold-dark">Margin +{formatPaise(margin)} ({marginPct}%)</p>
                <p className="text-[11px] text-muted mt-0.5">{r.qty > 0 ? `${r.qty} in stock` : "Out of stock"}{r.colours.length ? ` · ${r.colours.join(", ")}` : ""}</p>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="mt-6 border-t border-ink/10 pt-3 text-xs text-muted print:fixed print:bottom-0">
        Order online at your dealer portal · Minimum order {formatPaise(formula.wholesaleMinOrder ?? 300000)} · Contact us on WhatsApp to confirm dispatch.
      </footer>
    </div>
  );
}
