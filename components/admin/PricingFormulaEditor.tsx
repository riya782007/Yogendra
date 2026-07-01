"use client";

import { useMemo, useState } from "react";
import type { PricingFormula } from "@/lib/pricing";
import { buildupBreakdown, computePrices, formatPaise } from "@/lib/pricing";

type Props = {
  initial: PricingFormula;
  action: (formData: FormData) => void | Promise<void>;
};

type PctField = { key: keyof PricingFormula; name: string; label: string; hint: string };
const PCT_HEAD: PctField[] = [
  { key: "shippingPct", name: "shipping_pct", label: "Shipping %", hint: "freight / transport on cost" },
];
const PCT_TAIL: PctField[] = [
  { key: "resellerPct", name: "reseller_pct", label: "Reseller margin %", hint: "→ wholesale price" },
  { key: "customerDiscountPct", name: "customer_discount_pct", label: "Customer step %", hint: "→ retail (rounds to end in ₹9)" },
  { key: "mrpPct", name: "mrp_pct", label: "MRP markup %", hint: "→ printed MRP (rounds to nearest ₹5)" },
];

export default function PricingFormulaEditor({ initial, action }: Props) {
  const [useBuildup, setUseBuildup] = useState(Boolean(initial.useBuildup));
  const [sampleRupees, setSampleRupees] = useState(200);
  const [pct, setPct] = useState({
    shippingPct: initial.shippingPct ?? 10,
    resellerPct: initial.resellerPct ?? 15,
    customerDiscountPct: initial.customerDiscountPct ?? 5,
    mrpPct: initial.mrpPct ?? 25,
  });
  // Packing & Promotion are FLAT ₹ amounts (owner's rule), held in rupees for the inputs.
  const [flat, setFlat] = useState({
    packing: (initial.packingFlat ?? 2500) / 100,
    promotion: (initial.promotionFlat ?? 2500) / 100,
  });
  const [mult, setMult] = useState({
    wholesaleMarkupPct: initial.wholesaleMarkupPct,
    retailMultiplier: initial.retailMultiplier,
    mrpMultiplier: initial.mrpMultiplier,
    roundToPaise: initial.roundToPaise,
  });

  const formula: PricingFormula = useMemo(
    () => ({ ...mult, ...pct, packingFlat: Math.round((Number(flat.packing) || 0) * 100), promotionFlat: Math.round((Number(flat.promotion) || 0) * 100), roundToPaise: mult.roundToPaise, useBuildup }),
    [mult, pct, flat, useBuildup],
  );

  const basePaise = Math.round((Number(sampleRupees) || 0) * 100);
  const bd = useMemo(() => buildupBreakdown(basePaise, formula), [basePaise, formula]);
  const finalPrices = useMemo(() => computePrices(basePaise, formula), [basePaise, formula]);

  const setP = (k: keyof typeof pct, v: number) => setPct((s) => ({ ...s, [k]: v }));

  return (
    <form action={action} className="space-y-6">
      {/* Mode toggle */}
      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 cursor-pointer">
        <input
          type="checkbox"
          name="use_buildup"
          checked={useBuildup}
          onChange={(e) => setUseBuildup(e.target.checked)}
          className="mt-1 h-5 w-5 accent-amber-600"
        />
        <span>
          <span className="font-semibold text-stone-800">Use the % cost build-up (Yogendra's sheet)</span>
          <span className="block text-sm text-stone-500">
            When ON, every price is derived from the item's cost through the chain below. When OFF, the old
            multipliers are used. Changing this re-prices the whole catalogue.
          </span>
        </span>
      </label>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Percentage inputs */}
        <div className={`rounded-xl border p-4 ${useBuildup ? "border-stone-200" : "border-stone-200 opacity-50"}`}>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Build-up percentages</h3>
          <div className="space-y-3">
            {[...PCT_HEAD, ...PCT_TAIL].map((f, idx) => (
              <div key={f.name}>
                <div className="flex items-center gap-3">
                  <label className="flex-1">
                    <span className="block text-sm font-medium text-stone-700">{f.label}</span>
                    <span className="block text-xs text-stone-400">{f.hint}</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.01"
                      name={f.name}
                      value={(pct as any)[f.key]}
                      onChange={(e) => setP(f.key as keyof typeof pct, Number(e.target.value))}
                      className="w-24 rounded-lg border border-stone-300 px-3 py-1.5 text-right tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1.5 text-stone-400">%</span>
                  </div>
                </div>
                {/* After Shipping (idx 0), inject the two FLAT ₹ charges (Packing, Promotion). */}
                {idx === 0 && ([["packing", "Packing", "boxes, pouches, labour", "packing_flat_rupees"], ["promotion", "Promotion", "marketing / overhead", "promotion_flat_rupees"]] as const).map(([k, label, hint, name]) => (
                  <div key={name} className="flex items-center gap-3 mt-3">
                    <label className="flex-1">
                      <span className="block text-sm font-medium text-stone-700">{label} ₹ <span className="text-stone-400 font-normal">(flat)</span></span>
                      <span className="block text-xs text-stone-400">{hint} — fixed ₹ amount</span>
                    </label>
                    <div className="relative">
                      <input type="number" step="1" min={0} name={name} value={flat[k]}
                        onChange={(e) => setFlat((s) => ({ ...s, [k]: Number(e.target.value) }))}
                        className="w-24 rounded-lg border border-stone-300 pl-6 pr-3 py-1.5 text-right tabular-nums" />
                      <span className="pointer-events-none absolute left-3 top-1.5 text-stone-400">₹</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Live preview</h3>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              Cost ₹
              <input
                type="number"
                value={sampleRupees}
                onChange={(e) => setSampleRupees(Number(e.target.value))}
                className="w-20 rounded-lg border border-stone-300 px-2 py-1 text-right tabular-nums"
              />
            </label>
          </div>
          {useBuildup ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-emerald-100">
                <Row label="Cost" value={bd.base} />
                <Row label={`+ Shipping (${pct.shippingPct}%)`} value={bd.afterShipping} />
                <Row label={`+ Packing (₹${flat.packing})`} value={bd.afterPacking} />
                <Row label={`+ Promotion (₹${flat.promotion})`} value={bd.afterPromotion} sub="landed cost" />
                <Row label={`+ Reseller (${pct.resellerPct}%)`} value={bd.wholesale} strong tag="WHOLESALE" />
                <Row label={`+ Customer (${pct.customerDiscountPct}%) → ₹9`} value={bd.retail} strong tag="RETAIL" />
                <Row label={`+ MRP markup (${pct.mrpPct}%) → ₹5`} value={bd.mrp} strong tag="MRP" />
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-stone-500">
              Build-up is OFF — using multipliers. Wholesale {formatPaise(finalPrices.wholesaleRate)}, Retail{" "}
              {formatPaise(finalPrices.retailPrice)}, MRP {formatPaise(finalPrices.mrp)} for a ₹{sampleRupees} cost.
            </p>
          )}
          <p className="mt-3 text-xs text-stone-400">
            Prices are rounded to the nearest ₹{(mult.roundToPaise / 100).toFixed(0)} on the storefront.
          </p>
        </div>
      </div>

      {/* Legacy multipliers + rounding */}
      <details className="rounded-xl border border-stone-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-stone-600">
          Old multiplier mode &amp; rounding (used when build-up is OFF)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field name="wholesale_markup_pct" label="Wholesale markup %" value={mult.wholesaleMarkupPct}
            onChange={(v) => setMult((s) => ({ ...s, wholesaleMarkupPct: v }))} step="0.1" />
          <Field name="retail_multiplier" label="Retail ×" value={mult.retailMultiplier}
            onChange={(v) => setMult((s) => ({ ...s, retailMultiplier: v }))} step="0.01" />
          <Field name="mrp_multiplier" label="MRP ×" value={mult.mrpMultiplier}
            onChange={(v) => setMult((s) => ({ ...s, mrpMultiplier: v }))} step="0.01" />
          <Field name="round_to" label="Round to (paise)" value={mult.roundToPaise}
            onChange={(v) => setMult((s) => ({ ...s, roundToPaise: v }))} step="1" />
        </div>
      </details>

      <div className="rounded-2xl border border-sand bg-white p-4 mb-4">
        <label className="text-sm font-medium text-ink">Minimum wholesale order (₹)</label>
        <p className="text-[11px] text-muted mb-2">Wholesale carts below this value can&apos;t check out.</p>
        <input name="wholesale_min_order_rupees" type="number" min={0} step={1} defaultValue={Math.round((initial.wholesaleMinOrder ?? 300000) / 100)}
          className="w-40 rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald" />
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          className="rounded-xl bg-stone-900 px-6 py-2.5 font-semibold text-white shadow hover:bg-stone-800"
        >
          Save pricing formula
        </button>
        <span className="text-sm text-stone-400">Applies to every product instantly.</span>
      </div>
    </form>
  );
}

function Row({ label, value, sub, strong, tag }: { label: string; value: number; sub?: string; strong?: boolean; tag?: string }) {
  return (
    <tr className={strong ? "font-semibold text-stone-900" : "text-stone-600"}>
      <td className="py-1.5">
        {label}
        {sub && <span className="ml-1 text-xs font-normal text-stone-400">({sub})</span>}
      </td>
      <td className="py-1.5 text-right tabular-nums">{formatPaise(value)}</td>
      <td className="py-1.5 pl-2 text-right">
        {tag && <span className="rounded bg-stone-900/90 px-1.5 py-0.5 text-[10px] font-bold text-white">{tag}</span>}
      </td>
    </tr>
  );
}

function Field({ name, label, value, onChange, step }: { name: string; label: string; value: number; onChange: (v: number) => void; step: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-stone-600">{label}</span>
      <input
        type="number"
        step={step}
        name={name}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-1.5 text-right tabular-nums"
      />
    </label>
  );
}
