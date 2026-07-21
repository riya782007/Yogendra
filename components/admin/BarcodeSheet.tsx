"use client";
import { useState, useMemo, useEffect } from "react";
import { Barcode } from "@/components/admin/Barcode";
import { QtyField } from "@/components/admin/QtyField";
import { barcodeLookupAction } from "@/app/actions/barcodes";

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
// 65-up = the owner's pre-cut sheet (Avery L7651 layout): 38.1×21.2mm labels, 5 columns × 13 rows,
// horizontal pitch 40.6mm (38.1 + 2.5 gap), vertical pitch 21.2mm (no row gap), top margin 11.2mm
// (measured on the owner's physical sheet), left margin 4.75mm → all 65 land on ONE A4 (210×297).
// lw/lh = label width/height · gx/gy = gap between columns/rows · mt/ml = top/left sheet margin.
const PAPER = [
  { key: "65", label: "65 per sheet (5 × 13)", cols: 5, per: 65, lw: 38.1, lh: 21.2, gx: 2.5, gy: 0, mt: 11.2, ml: 4.75 },
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

  // Products/variants created AFTER this page loaded aren't in `products`. When a search finds nothing
  // locally, look it up LIVE from the database and merge the results in — so a just-created SKU always
  // appears without a reload. Debounced so it fires once the owner stops typing.
  const [extra, setExtra] = useState<P[]>([]);
  const pool = useMemo(() => {
    const seen = new Set(products.map((p) => p.sku.toUpperCase()));
    return [...products, ...extra.filter((e) => !seen.has(e.sku.toUpperCase()))];
  }, [products, extra]);

  const matches = useMemo(
    () => (q.trim() ? pool.filter((p) => (p.name + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 12) : []),
    [q, pool],
  );

  useEffect(() => {
    const code = q.trim();
    if (code.length < 2) return;
    // Already have a local hit → no need to hit the server.
    if (pool.some((p) => (p.name + p.sku).toLowerCase().includes(code.toLowerCase()))) return;
    const t = setTimeout(() => {
      barcodeLookupAction(code).then((hits) => {
        if (!hits?.length) return;
        setExtra((prev) => {
          const have = new Set(prev.map((x) => x.sku.toUpperCase()));
          const add = hits.filter((h) => !have.has(h.sku.toUpperCase())) as P[];
          return add.length ? [...prev, ...add] : prev;
        });
      }).catch(() => { /* search never blocks */ });
    }, 350);
    return () => clearTimeout(t);
  }, [q, pool]);
  const G = PAPER.find((p) => p.key === paper) ?? PAPER[0];
  // Handover: the owner uses one fixed pre-cut sheet and never changes these, so the paper-size,
  // label-content and printer-alignment controls are hidden (defaults kept). Set true to expose them.
  const SHOW_ADVANCED = false;
  const cols = G.cols;
  const per = G.per;
  // Special price is a FIXED constant (23) across all products — the owner's coded scheme. The
  // retail's ".51" tax add-on is applied by codeRetail at print time (product price is untouched).
  const SPECIAL_FIXED = "23";
  const toRow = (p: P): Row => ({ sku: p.sku, name: p.name, qty: 1, price: rup(p.price), special: SPECIAL_FIXED, wholesale: rup(p.wholesale) });
  const add = (p: P) => { setRows((prev) => (prev.find((x) => x.sku === p.sku) ? prev : [...prev, toRow(p)])); setQ(""); };
  /** Variant SKUs are what the POS scans — a design with colours should print one per variant. */
  const addAllVariants = (parentSku: string) => {
    const vars = pool.filter((x) => x.kind === "variant" && x.parentSku === parentSku);
    setRows((prev) => {
      const have = new Set(prev.map((x) => x.sku));
      return [...prev, ...vars.filter((v) => !have.has(v.sku)).map(toRow)];
    });
    setQ("");
  };
  const patch = (sku: string, p: Partial<Row>) => setRows((prev) => prev.map((x) => (x.sku === sku ? { ...x, ...p } : x)));
  const rm = (sku: string) => setRows((prev) => prev.filter((x) => x.sku !== sku));

  const labels = rows.flatMap((r) => Array.from({ length: Math.max(1, r.qty) }, () => r));

  /**
   * Print via an ISOLATED iframe document. The admin page's stylesheets (invoice A5 @page,
   * catalogue @page, Tailwind resets, layout padding) can never touch it, and the iframe's own
   * @page { margin: 0 } guarantees the die-cut geometry starts at the paper edge — so 13 rows
   * (11.2mm top + 13 × 21.2mm = 286.8mm) always fit one A4 and every label lands on its pre-cut spot.
   * Print dialog must be at 100% scale ("Actual size"), margins "Default/None".
   */
  const printLabels = () => {
    const grid = document.getElementById("bc-preview-grid");
    if (!grid) return;
    const mt = (G.mt + adjTop).toFixed(2);
    const lh = (G.lh + adjRow).toFixed(2);
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(f);
    const d = f.contentDocument;
    const w = f.contentWindow;
    if (!d || !w) { document.body.removeChild(f); return; }
    d.open();
    d.write(`<!doctype html><html><head><meta charset="utf-8"><title>labels</title><style>
      @page { size: A4 portrait; margin: 0; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 210mm; background: #fff; }
      .sheet { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page;
               padding: ${mt}mm 0 0 ${G.ml}mm; }
      .sheet:last-child { page-break-after: auto; break-after: auto; }
      .grid { display: grid; grid-template-columns: repeat(${cols}, ${G.lw}mm);
              grid-auto-rows: ${lh}mm; column-gap: ${G.gx}mm; row-gap: ${G.gy}mm;
              justify-content: start; align-content: start; }
      .barcode-label { width: ${G.lw}mm; height: ${lh}mm; overflow: hidden; padding: 0.4mm;
                       display: flex; flex-direction: column; align-items: center; justify-content: center;
                       text-align: center; font-family: Arial, Helvetica, sans-serif; color: #000; }
      .bc-name { font-size: 6pt; line-height: 1.1; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bc-sku { font-size: 6pt; margin-bottom: 0.4mm; line-height: 1; letter-spacing: 0.02em; }
      .bc-price { font-size: 7pt; line-height: 1.05; font-weight: 700; }
      .barcode-label svg { height: 9mm; width: ${barW}%; display: block; margin: 0 auto; }
    </style></head><body></body></html>`);
    d.close();
    const labelEls = Array.from(grid.children);
    for (let i = 0; i < labelEls.length; i += per) {
      const sheet = d.createElement("div"); sheet.className = "sheet";
      const g = d.createElement("div"); g.className = "grid";
      for (const el of labelEls.slice(i, i + per)) g.appendChild(d.importNode(el, true));
      sheet.appendChild(g);
      d.body.appendChild(sheet);
    }
    w.focus();
    w.print();
    setTimeout(() => { try { document.body.removeChild(f); } catch {} }, 60_000);
  };
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
  // Non-breaking spaces so the gaps actually PRINT (HTML collapses normal runs of spaces):
  // wide gap after retail, single gap before the 7…7 cost code → e.g. "329.51   23 71907".
  const GAP_WIDE = "\u00A0\u00A0\u00A0";
  const GAP = "\u00A0";
  const priceLine = (r: Row) => {
    const retail = opts.price ? codeRetail(r.price) : "";
    const whole = opts.wholesale ? codeWholesale(r.wholesale) : "";
    const special = (r.special.trim() || SPECIAL_FIXED);
    // Both segments shown → retail, special connector, cost code — visibly separated for quick
    // reading at the counter while staying one line on the label.
    if (retail && whole) return retail + GAP_WIDE + special + GAP_WIDE + whole;
    // Only one segment (or the explicit Show-Special toggle) → same separators, graceful.
    const parts = [retail, opts.special ? special : "", whole].filter(Boolean);
    return parts.join(GAP_WIDE);
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
                    <td className="py-2 pr-3 text-right"><input className={cell} inputMode="decimal" value={r.wholesale} onChange={(e) => patch(r.sku, { wholesale: e.target.value })} /></td>
                    <td className="py-2 text-right"><button onClick={() => rm(r.sku)} className="text-xs px-3 py-1.5 rounded-lg bg-rose/10 text-rose hover:bg-rose/20">Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {SHOW_ADVANCED && (<>
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
              {([["sku", "Show SKU"], ["name", "Show Product Name"], ["price", "Show Price"], ["wholesale", "Show cost code (7·x·7)"], ["currency", "Show Currency"]] as const).map(([k, label]) => (
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
        </>)}

        <div className="flex items-center justify-between flex-wrap gap-3 mt-5">
          <div className="text-sm text-muted">Total Barcodes <span className="text-ink font-semibold text-base">{labels.length}</span>{labels.length > 0 && <> · ~{Math.ceil(labels.length / per)} sheet{Math.ceil(labels.length / per) === 1 ? "" : "s"}</>}</div>
          {labels.length > 0 && (
            <button onClick={printLabels} className="btn-primary px-6 py-2.5 text-sm font-medium">🖶 Print {labels.length} label{labels.length === 1 ? "" : "s"}</button>
          )}
        </div>
      </div>

      {/* On-screen PREVIEW grid (printing uses an isolated iframe built by printLabels above) */}
      {labels.length > 0 && (
        <div className="no-print">
          <div id="bc-preview-grid" className="barcode-grid grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` } as any}>
            {labels.map((it, i) => {
              const line = priceLine(it);
              return (
                <div key={i} className="barcode-label text-center bg-white break-inside-avoid">
                  {opts.name && <p className="bc-name font-semibold text-ink truncate">{it.name}</p>}
                  {/* SKU sits ABOVE the barcode to match the reference tag layout. */}
                  {opts.sku && <p className="bc-sku tracking-wide text-ink">SKU {it.sku}</p>}
                  <Barcode value={it.sku} height={28} unit={cols >= 8 ? 0.85 : 1.1} />
                  {line && <p className="bc-price font-semibold text-ink">{line}</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
