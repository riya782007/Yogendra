"use client";

import { useMemo, useState } from "react";
import type { PricingFormula } from "@/lib/pricing";
import { buildupBreakdown, computePrices, formatPaise } from "@/lib/pricing";

type Props = {
  initial: PricingFormula;
  action: (formData: FormData) => void | Promise<void>;
};

export default function PricingFormulaEditor({ initial, action }: Props) {
  const [useBuildup, setUseBuildup] = useState(initial.useBuildup ?? true);
  const [sampleRupees, setSampleRupees] = useState(200);

  // The six build-up steps of the owner's costing sheet. Flat charges are edited in ₹ (stored paise).
  const [f, setF] = useState({
    shippingPct: initial.shippingPct ?? 10,
    packingRupees: Math.round((initial.packingFlat ?? 2500) / 100),
    promotionRupees: Math.round((initial.promotionFlat ?? 2500) / 100),
    resellerPct: initial.resellerPct ?? 15,
    customerDiscountPct: initial.customerDiscountPct ?? 5,
    mrpPct: initial.mrpPct ?? 25,
  });
  const set = (k: keyof typeof f, v: number) => setF((s) => ({ ...s, [k]: v }));

  const [mult, setMult] = useState({
    wholesaleMarkupPct: initial.wholesaleMarkupPct,
    retailMultiplier: initial.retailMultiplier,
    mrpMultiplier: initial.mrpMultiplier,
    roundToPaise: initial.roundToPaise,
  });

  const formula: PricingFormula = useMemo(
    () => ({
      ...mult,
      roundToPaise: mult.roundToPaise,
      useBuildup,
      shippingPct: f.shippingPct,
      packingFlat: Math.round(f.packingRupees * 100),
      promotionFlat: Math.round(f.promotionRupees * 100),
      resellerPct: f.resellerPct,
      customerDiscountPct: f.customerDiscountPct,
      mrpPct: f.mrpPct,
    }),
    [mult, f, useBuildup],
  );

  const basePaise = Math.round((Number(sampleRupees) || 0) * 100);
  const bd = useMemo(() => buildupBreakdown(basePaise, formula), [basePaise, formula]);
  const finalPrices = useMemo(() => computePrices(basePaise, formula), [basePaise, formula]);

  return (
    <form action={action} className="space-y-6">
      {/* Where prices come from */}
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
        <p className="font-semibold text-stone-800">Where pricing comes from</p>
        <p className="mt-1">
          <b>Base wholesale price</b> — entered on each product (the rate you sell to resellers at) — is the
          single input this formula builds on to produce the <b>Retail</b> selling price and the <b>MRP</b>.
        </p>
        <p className="mt-1">
          The price on a <b>purchase bill</b> is kept only as a reference (so next time you buy the same SKU you
          can spot a supplier over-charge). It never affects wholesale, retail or MRP.
        </p>
      </div>

      {/* Mode toggle */}
      <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 cursor-pointer">
        <input type="checkbox" name="use_buildup" checked={useBuildup} onChange={(e) => setUseBuildup(e.target.checked)} className="mt-1 h-5 w-5 accent-amber-600" />
        <span>
          <span className="font-semibold text-stone-800">Use the % build-up (recommended — matches your costing sheet)</span>
          <span className="block text-sm text-stone-500">
            Retail &amp; MRP are derived from the base wholesale price through the six steps below.
            When OFF, the old flat multipliers are used instead. Changing anything here re-prices the whole catalogue instantly.
          </span>
        </span>
      </label>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Build-up inputs — the sheet, step by step */}
        <div className={`rounded-xl border p-4 ${useBuildup ? "border-stone-200" : "border-stone-200 opacity-50"}`}>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-stone-500">The build-up (base wholesale → retail → MRP)</h3>
          <p className="mb-3 text-xs text-stone-400">Applied in order, exactly like your Excel sheet.</p>
          <div className="space-y-3">
            <StepRow n={1} label="Free shipping" hint="add % to the wholesale price" unit="%" name="shipping_pct" value={f.shippingPct} onChange={(v) => set("shippingPct", v)} />
            <StepRow n={2} label="Packing" hint="flat charge added" unit="₹" name="packing_flat_rupees" value={f.packingRupees} onChange={(v) => set("packingRupees", v)} step="1" />
            <StepRow n={3} label="Promotion" hint="flat charge added" unit="₹" name="promotion_flat_rupees" value={f.promotionRupees} onChange={(v) => set("promotionRupees", v)} step="1" />
            <StepRow n={4} label="Reseller margin" hint="add %" unit="%" name="reseller_pct" value={f.resellerPct} onChange={(v) => set("resellerPct", v)} />
            <StepRow n={5} label="Reseller-referral discount" hint="add % → this is the RETAIL price" unit="%" name="customer_discount_pct" value={f.customerDiscountPct} onChange={(v) => set("customerDiscountPct", v)} />
            <StepRow n={6} label="MRP markup" hint="retail × % → printed MRP" unit="%" name="mrp_pct" value={f.mrpPct} onChange={(v) => set("mrpPct", v)} />
          </div>
        </div>

        {/* Live preview — reproduces the sheet line by line */}
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-emerald-700">Live preview</h3>
            <label className="flex items-center gap-2 text-sm text-stone-600">
              Base wholesale ₹
              <input type="number" value={sampleRupees} onChange={(e) => setSampleRupees(Number(e.target.value))} className="w-24 rounded-lg border border-stone-300 px-2 py-1 text-right tabular-nums" />
            </label>
          </div>
          {useBuildup ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-emerald-100">
                <Row label="Base wholesale (entered)" value={bd.wholesale} strong tag="WHOLESALE" />
                <Row label={`+ Free shipping (${f.shippingPct}%)`} value={bd.afterShipping} />
                <Row label={`+ Packing (₹${f.packingRupees})`} value={bd.afterPacking} />
                <Row label={`+ Promotion (₹${f.promotionRupees})`} value={bd.afterPromotion} />
                <Row label={`+ Reseller margin (${f.resellerPct}%)`} value={bd.afterReseller} />
                <Row label={`+ Reseller-referral (${f.customerDiscountPct}%)`} value={bd.retail} strong tag="RETAIL" />
                <Row label={`× MRP markup (${f.mrpPct}%)`} value={bd.mrp} strong tag="MRP" />
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-stone-500">
              Build-up is OFF — using multipliers. Wholesale {formatPaise(finalPrices.wholesaleRate)}, Retail{" "}
              {formatPaise(finalPrices.retailPrice)}, MRP {formatPaise(finalPrices.mrp)} for a ₹{sampleRupees} base wholesale.
            </p>
          )}
          <p className="mt-3 text-xs text-stone-400">Prices are rounded to the nearest ₹{(mult.roundToPaise / 100).toFixed(0)}.</p>
        </div>
      </div>

      {/* Legacy multipliers + rounding */}
      <details className="rounded-xl border border-stone-200 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-stone-600">Old multiplier mode &amp; rounding (used only when build-up is OFF)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field name="wholesale_markup_pct" label="Wholesale markup %" value={mult.wholesaleMarkupPct} onChange={(v) => setMult((s) => ({ ...s, wholesaleMarkupPct: v }))} step="0.1" />
          <Field name="retail_multiplier" label="Retail ×" value={mult.retailMultiplier} onChange={(v) => setMult((s) => ({ ...s, retailMultiplier: v }))} step="0.01" />
          <Field name="mrp_multiplier" label="MRP ×" value={mult.mrpMultiplier} onChange={(v) => setMult((s) => ({ ...s, mrpMultiplier: v }))} step="0.01" />
          <Field name="round_to" label="Round to (paise)" value={mult.roundToPaise} onChange={(v) => setMult((s) => ({ ...s, roundToPaise: v }))} step="1" />
        </div>
      </details>

      <div className="rounded-2xl border border-sand bg-white p-4 mb-4">
        <label className="text-sm font-medium text-ink">Minimum wholesale order (₹)</label>
        <p className="text-[11px] text-muted mb-2">Wholesale carts below this value can&apos;t check out.</p>
        <input name="wholesale_min_order_rupees" type="number" min={0} step={1} defaultValue={Math.round((initial.wholesaleMinOrder ?? 300000) / 100)} className="w-40 rounded-xl border border-sand px-3 py-2 text-sm outline-none focus:border-emerald" />
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-xl bg-stone-900 px-6 py-2.5 font-semibold text-white shadow hover:bg-stone-800">Save pricing formula</button>
        <span className="text-sm text-stone-400">Applies to every product instantly.</span>
      </div>
    </form>
  );
}

function StepRow({ n, label, hint, unit, name, value, onChange, step = "0.01" }: { n: number; label: string; hint: string; unit: string; name: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-stone-900 text-[11px] font-bold text-white">{n}</span>
      <label className="flex-1">
        <span className="block text-sm font-medium text-stone-700">{label}</span>
        <span className="block text-xs text-stone-400">{hint}</span>
      </label>
      <div className="relative">
        {unit === "₹" && <span className="pointer-events-none absolute left-2.5 top-1.5 text-stone-400">₹</span>}
        <input type="number" step={step} name={name} value={value} onChange={(e) => onChange(Number(e.target.value))}
          className={`w-24 rounded-lg border border-stone-300 py-1.5 text-right tabular-nums ${unit === "₹" ? "pl-6 pr-3" : "px-3"}`} />
        {unit === "%" && <span className="pointer-events-none absolute right-3 top-1.5 text-stone-400">%</span>}
      </div>
    </div>
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
      <input type="number" step={step} name={name} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-1.5 text-right tabular-nums" />
    </label>
  );
}
