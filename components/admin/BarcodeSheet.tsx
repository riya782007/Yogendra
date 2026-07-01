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

// Paper presets → number of label columns across an A4 sheet (drives print density).
const PAPER = [
  { key: "65", label: "65 per sheet (5 × 13)", cols: 5, per: 65 },
  { key: "48", label: "48 per sheet (4 × 12)", cols: 4, per: 48 },
  { key: "40", label: "40 per sheet (4 × 10)", cols: 4, per: 40 },
  { key: "24", label: "24 per sheet (3 × 8)", cols: 3, per: 24 },
  { key: "64", label: "64 per sheet (8 × 8)", cols: 8, per: 64 },
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

  const matches = useMemo(
    () => (q.trim() ? products.filter((p) => (p.name + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 10) : []),
    [q, products],
  );
  const cols = PAPER.find((p) => p.key === paper)?.cols ?? 5;
  const per = PAPER.find((p) => p.key === paper)?.per ?? 65;

  const toRow = (p: P): Row => ({ sku: p.sku, name: p.name, qty: 1, price: rup(p.price), special: "", wholesale: rup(p.wholesale) });
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

  const money = (v: string) => {
    const s = (v ?? "").trim();
    if (!s) return "";
    return opts.currency ? `₹${s}` : s;
  };
  // Wholesale / cost is printed as a private code (7·price·7) so a customer glancing at the
  // tag can't read the trade price — staff decode it at a glance. e.g. ₹40 -> "7407".
  const codeWholesale = (v: string) => {
    const n = Math.round(Number((v ?? "").trim()));
    return Number.isFinite(n) && n > 0 ? `7${n}7` : "";
  };
  const priceLine = (r: Row) => [opts.price && money(r.price), opts.special && money(r.special), opts.wholesale && codeWholesale(r.wholesale)]
    .filter((x) => x && x !== "").join("  ");

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

        <div className="flex items-center justify-between flex-wrap gap-3 mt-5">
          <div className="text-sm text-muted">Total Barcodes <span className="text-ink font-semibold text-base">{labels.length}</span>{labels.length > 0 && <> · ~{Math.ceil(labels.length / per)} sheet{Math.ceil(labels.length / per) === 1 ? "" : "s"}</>}</div>
          {labels.length > 0 && (
            <button onClick={() => window.print()} className="btn-primary px-6 py-2.5 text-sm font-medium">🖶 Print {labels.length} label{labels.length === 1 ? "" : "s"}</button>
          )}
        </div>
      </div>

      {/* Printable label grid — density set by paper size via --bc-cols */}
      {labels.length > 0 && (
        <div className="print-area">
          <div className="barcode-grid grid gap-1" style={{ "--bc-cols": cols, gridTemplateColumns: `repeat(${cols}, 1fr)` } as any}>
            {labels.map((it, i) => {
              const line = priceLine(it);
              return (
                <div key={i} className="barcode-label border border-sand text-center bg-white break-inside-avoid">
                  {opts.name && <p className="bc-name font-semibold text-ink truncate">{it.name}</p>}
                  <Barcode value={it.sku} height={30} unit={1.1} />
                  {opts.sku && <p className="bc-sku tracking-widest text-ink">{it.sku}</p>}
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
