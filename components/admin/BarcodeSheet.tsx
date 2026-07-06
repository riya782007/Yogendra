"use client";
import { useState, useMemo } from "react";
import { Barcode } from "@/components/admin/Barcode";
import { QtyField } from "@/components/admin/QtyField";

type P = {
  sku: string; name: string;
  price: number; wholesale?: number; mrp?: number; // paise
  kind?: "product" | "variant";
  option?: string;
  parentSku?: string;
  variantCount?: number;
};

type Row = {
  sku: string; name: string;
  qty: number;
  price: string; special: string; wholesale: string; // rupees, editable
};

// Paper presets with EXACT die-cut geometry in mm, so each barcode lands on its physical label.
// 65-up = the standard Avery L7651 sheet: 38.1×21.2mm labels, 10.7mm top margin, 4.75mm side
// margin, 2.5mm gap between columns, no gap between rows → 5×13 fills one A4 exactly (297mm tall).
// lw/lh = label width/height · gx/gy = gap between columns/rows · mt/ml = top/left sheet margin.
const PAPER = [
  { key: "65", label: "65 per sheet (5 × 13)", cols: 5, per: 65, lw: 38.1, lh: 21.2, gx: 2.5, gy: 0, mt: 10.7, ml: 4.75 },
  { key: "48", label: "48 per sheet (4 × 12)", cols: 4, per: 48, lw: 45.7, lh: 22.5, gx: 2.5, gy: 0, mt: 13.5, ml: 8.0 },
  { key: "40", label: "40 per sheet (4 × 10)", cols: 4, per: 40, lw: 45.7, lh: 25.4, gx: 2.5, gy: 0, mt: 21.5, ml: 8.0 },
  { key: "24", label: "24 per sheet (3 × 8)", cols: 3, per: 24, lw: 63.5, lh: 33.9, gx: 2.5, gy: 0, mt: 12.7, ml: 7.2 },
  { key: "64", label: "64 per sheet (8 × 8)", cols: 8, per: 64, lw: 23.0, lh: 33.0, gx: 2.0, gy: 2.0, mt: 8.0, ml: 6.0 },
];

const rup = (paise?: number) => {
  if (paise == null || !Number.isFinite(paise)) return "";
  const v = paise / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

export function BarcodeSheet({ products }: { products: P[] }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [paper, setPaper] = useState("65");
  const [opts, setOpts] = useState({ sku: true, name: false, price: true, special: false, wholesale: true, currency: false });
  // Printer fine-tuning — physical label sheets and printers vary slightly, so these let the owner
  // nudge the layout live: top margin, row height (fixes cumulative drift where lower rows slip off
  // their labels), and barcode bar width. Defaults are 0 nudge and a slightly narrower 92% bar.
  const [adjTop, setAdjTop] = useState(0);   // mm added to the top margin
  const [adjRow, setAdjRow] = useState(0);   // mm added to EACH row's height
  const [barW, setBarW] = useState(92);      // printed bar width as % of the label

  const matches = useMemo(
    () => (q.trim() ? products.filter((p) => (p.name + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 10) : []),
    [q, products],
  );
  const G = PAPER.find((p) => p.key === paper) ?? PAPER[0];
  const cols = G.cols;
  const per = G.per;
  // Feed the exact geometry to the print stylesheet as CSS variables. The @media print rules below
  // consume these so every label sits on its die-cut position and all rows fit on ONE A4 sheet.
  const sheetVars = {
    "--bc-cols": cols,
    "--bc-lw": `${G.lw}mm`, "--bc-lh": `${(G.lh + adjRow).toFixed(2)}mm`,
    "--bc-gx": `${G.gx}mm`, "--bc-gy": `${G.gy}mm`,
    "--bc-mt": `${(G.mt + adjTop).toFixed(2)}mm`, "--bc-ml": `${G.ml}mm`,
    "--bc-bw": `${barW}%`,
  };

  // Barcode-only rule (owner): the printed retail Price carries a fixed +₹0.51 tax add-on — the
  // actual product/storefront price is NOT changed. Editable, so the owner can still override it.
  const toRow = (p: P): Row => ({ sku: p.sku, name: p.name, qty: 1, price: rup((p.price ?? 0) + 51), special: "", wholesale: rup(p.wholesale) });
  const add = (p: P) => { setRows((prev) => (prev.find((x) => x.sku === p.sku) ? prev : [...prev, toRow(p)])); setQ(""); };
  /** Variant SKUs are what the POS scans — a design with colours should print one per variant. */
  const addAllVariants = (parentSku: string) => {
    const vars = products.filter((x) => x.kind === "variant" && x.parentSku === parentSku);
    setRows((prev) => {
      const have = new Set(prev.map((x) => x.sku));
      return [...prev, ...vars.filter((v) => !have.has(v.sku)).map(toRow)];
    });
    setQ("");
  };
  const patch = (sku: string, p: Partial<Row>) => setRows((prev) => prev.map((x) => (x.sku === sku ? { ...x, ...p } : x)));
  const rm = (sku: string) => setRows((prev) => prev.filter((x) => x.sku !== sku));

  const labels = rows.flatMap((r) => Array.from({ length: Math.max(1, r.qty) }, () => r));
  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  const cell = "w-24 rounded-lg border border-sand px-2 py-1 text-sm text-right outline-none focus:border-emerald";

  // Retail printed with a fixed ".51" suffix — the owner's way of masking the true price inside the
  // code. e.g. 120 -> "120.51", 319 -> "319.51". (Any decimals the owner typed are dropped first.)
  const codeRetail = (v: string) => {
    const int = (v ?? "").trim().split(".")[0].replace(/[^\d]/g, "");
    return int ? `${int}.51` : "";
  };
  // Wholesale / cost printed as a private code (7·price·7) so a customer glancing at the tag can't
  // read the trade price — staff decode it at a glance. e.g. 100 -> "71007".
  const codeWholesale = (v: string) => {
    const n = Math.round(Number((v ?? "").trim()));
    return Number.isFinite(n) && n > 0 ? `7${n}7` : "";
  };
  // The owner's coded price string — concatenated with NO separators:
  //   {retail}.51  +  {fixed special = 23}  +  7{wholesale}7
  // e.g. retail 229, wholesale 120 -> "229.51" + "23" + "71207" = "229.512371207".
  // The fixed "23" is STRUCTURAL glue in the code — it always sits between the retail part and the
  // cost code whenever both are shown, independent of the "Show Special Price" display toggle.
  const priceLine = (r: Row) => {
    const retail = opts.price ? codeRetail(r.price) : "";
    const whole = opts.wholesale ? codeWholesale(r.wholesale) : "";
    const special = (r.special.trim() || SPECIAL_FIXED);
    // Both segments shown → embed the special connector between them (the owner's masked tag).
    if (retail && whole) return retail + special + whole;
    // Only one segment (or the explicit Show-Special toggle) → fall back gracefully.
    let out = retail;
    if (opts.special) out += special;
    out += whole;
    return out;
  };

  return (
    <div>
      {/* Builder */}
      <div className="bg-white rounded-2xl p-5 shadow-card mb-5 no-print">
        <h2 className="font-medium text-ink mb-1">Add SKUs to print</h2>
        <p className="text-xs text-muted mb-3">
          Designs with colours/sizes print one label <b>per variant</b> (e.g. <span className="font-mono">BD1001 · Red</span>) —
          those variant codes scan at billing to pick the exact piece. Use <b>Add all variants</b> to queue every colour of a design.
        </p>
        <div className="relative mb-4">
          <input className={input} placeholder="Search product or variant by name / SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
              {matches.map((p) => {
                const hasVars = p.kind === "product" && (p.variantCount ?? 0) > 0;
                const isVariant = p.kind === "variant";
                return (
                  <div key={p.sku} className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-emerald-mist">
                    <button onClick={() => (hasVars ? addAllVariants(p.sku) : add(p))} className="flex-1 text-left min-w-0">
                      <span className="truncate">
                        {isVariant && <span className="text-muted">↳ </span>}
                        {p.name} <span className="text-muted">· {p.sku}</span>
                        {hasVars && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-gold/15 text-gold-dark whitespace-nowrap">{p.variantCount} variants</span>}
                      </span>
                    </button>
                    {hasVars && <button onClick={() => addAllVariants(p.sku)} className="text-xs px-2.5 py-1 rounded-full bg-emerald text-white whitespace-nowrap shrink-0">+ Add all variants</button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Editable table */}
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No SKUs selected yet — search above to add products or variants.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3 text-center">Barcode Qty</th>
                  <th className="py-2 pr-3 text-right">Price</th>
                  <th className="py-2 pr-3 text-right">Special Price</th>
                  <th className="py-2 pr-3 text-right">Wholesale Price</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.sku} className="border-t border-sand/60">
                    <td className="py-2 pr-3 font-mono text-ink whitespace-nowrap">{r.sku}</td>
                    <td className="py-2 pr-3 text-ink min-w-[160px]">{r.name}</td>
                    <td className="py-2 pr-3 text-center">
                      <QtyField value={r.qty} onChange={(n) => patch(r.sku, { qty: Math.max(1, Math.floor(n || 1)) })} className="w-16 rounded-lg border border-sand px-2 py-1 text-center" />
                    </td>
                    <td className="py-2 pr-3 text-right"><input className={cell} inputMode="decimal" value={r.price} onChange={(e) => patch(r.sku, { price: e.target.value })} /></td>
                    <td className="py-2 pr-3 text-right"><input className={cell} inputMode="decimal" placeholder="—" value={r.special} onChange={(e) => patch(r.sku, { special: e.target.value })} /></td>
                    <td className="py-2 pr-3 text-right"><input className={cell} inputMode="decimal" value={r.wholesale} onChange={(e) => patch(r.sku, { wholesale: e.target.value })} /></td>
                    <td className="py-2 text-right"><button onClick={() => rm(r.sku)} className="text-xs px-3 py-1.5 rounded-lg bg-rose/10 text-rose hover:bg-rose/20">Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Paper size + options */}
        <div className="grid sm:grid-cols-2 gap-5 mt-5 pt-4 border-t border-sand">
          <div>
            <p className="text-xs font-medium text-muted mb-1">Paper Size</p>
            <select value={paper} onChange={(e) => setPaper(e.target.value)} className="w-full rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald">
              {PAPER.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div>
            <p className="text-xs font-medium text-muted mb-1">Barcode Options</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              {([["sku", "Show SKU"], ["name", "Show Product Name"], ["price", "Show Price"], ["special", "Show Special Price"], ["wholesale", "Show cost code (7·x·7)"], ["currency", "Show Currency"]] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={(opts as any)[k]} onChange={(e) => setOpts((o) => ({ ...o, [k]: e.target.checked }))} className="accent-emerald" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Printer alignment fine-tuning — nudge if labels don't sit perfectly on the physical sheet */}
        <div className="mt-4 pt-4 border-t border-sand">
          <p className="text-xs font-medium text-muted mb-2">Printer alignment <span className="text-muted/70 font-normal">— tweak only if the print is slightly off the labels</span></p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <label className="text-xs text-muted">
              Top margin <span className="text-ink font-medium">{(G.mt + adjTop).toFixed(1)}mm</span>
              <input type="range" min={-6} max={6} step={0.5} value={adjTop} onChange={(e) => setAdjTop(Number(e.target.value))} className="w-full accent-emerald" />
              <span className="text-[10px] text-muted/70">move all labels down / up</span>
            </label>
            <label className="text-xs text-muted">
              Row height <span className="text-ink font-medium">{(G.lh + adjRow).toFixed(1)}mm</span>
              <input type="range" min={-3} max={3} step={0.1} value={adjRow} onChange={(e) => setAdjRow(Number(e.target.value))} className="w-full accent-emerald" />
              <span className="text-[10px] text-muted/70">fixes lower rows drifting off</span>
            </label>
            <label className="text-xs text-muted">
              Barcode width <span className="text-ink font-medium">{barW}%</span>
              <input type="range" min={70} max={100} step={1} value={barW} onChange={(e) => setBarW(Number(e.target.value))} className="w-full accent-emerald" />
              <span className="text-[10px] text-muted/70">narrower bars per label</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3 mt-5">
          <div className="text-sm text-muted">Total Barcodes <span className="text-ink font-semibold text-base">{labels.length}</span>{labels.length > 0 && <> · ~{Math.ceil(labels.length / per)} sheet{Math.ceil(labels.length / per) === 1 ? "" : "s"}</>}</div>
          {labels.length > 0 && (
            <button onClick={() => window.print()} className="btn-primary px-6 py-2.5 text-sm font-medium">🖶 Print {labels.length} label{labels.length === 1 ? "" : "s"}</button>
          )}
        </div>
      </div>

      {/* Printable label grid — density set by paper size via --bc-cols */}
      {labels.length > 0 && (
        <div className="print-area bc-sheet" style={sheetVars as any}>
          {/* Print-only geometry: match the physical die-cut sheet exactly. `position: fixed` makes the
              sheet fill the page from the paper edge (escaping the admin page's padding), and @page
              margin:0 lets the top/side margins come from the label sheet's own spec — so 65 labels
              land on their labels and fit on ONE A4 instead of spilling onto a second page. */}
          <style>{`
            @media print {
              @page { size: A4; margin: 0 !important; }
              .bc-sheet.print-area { position: fixed !important; inset: 0 !important; width: 210mm !important; height: 297mm !important; margin: 0 !important; padding: var(--bc-mt) var(--bc-ml) 0 var(--bc-ml) !important; box-sizing: border-box !important; }
              .bc-sheet .barcode-grid { display: grid !important; grid-template-columns: repeat(var(--bc-cols), var(--bc-lw)) !important; column-gap: var(--bc-gx) !important; row-gap: var(--bc-gy) !important; justify-content: start !important; align-content: start !important; }
              .bc-sheet .barcode-label { width: var(--bc-lw) !important; height: var(--bc-lh) !important; box-sizing: border-box !important; overflow: hidden !important; }
              .bc-sheet .barcode-label svg { width: var(--bc-bw) !important; display: block !important; margin: 0 auto !important; }
            }
          `}</style>
          <div className="barcode-grid grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` } as any}>
            {labels.map((it, i) => {
              const line = priceLine(it);
              return (
                <div key={i} className="barcode-label text-center bg-white break-inside-avoid">
                  {opts.name && <p className="bc-name font-semibold text-ink truncate">{it.name}</p>}
                  <Barcode value={it.sku} height={28} unit={cols >= 8 ? 0.85 : 1.1} />
                  {opts.sku && <p className="bc-sku tracking-wide text-ink">SKU {it.sku}</p>}
                  {line && <p className="bc-price font-medium text-ink">{line}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
