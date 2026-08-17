"use client";

import { useState } from "react";
import { addVariantAction } from "@/app/actions/variants";
import { barcodeCodeForColor, snapColorName } from "@/lib/colors";

const vInput = "rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm text-ink focus:border-gold focus:outline-none";

/** Mirror of the server's autoSku() so the owner SEES the barcode SKU forming as they type — this
 *  reassures them the system makes the SKU automatically (they don't type it) and matches what the
 *  server will store. The server stays authoritative (and guarantees uniqueness). */
function previewSku(parentSku: string, color: string, size: string, polish: string, codes: Record<string, string>): string {
  const snapped = snapColorName(color);
  const cc = snapped ? (codes[snapped.toLowerCase()] ?? barcodeCodeForColor(snapped)) : null;
  const sz = size ? size.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
  const po = polish ? polish.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
  const suffix = [cc, sz, po].filter(Boolean).join("-") || "VAR";
  return `${parentSku}-${suffix}`;
}

/** Add-a-variant form. Prices are OPTIONAL and default to the product's own price (shown as the
 *  placeholder), so the owner never has to type them — this is what prevents the 1-paise formula
 *  artifact that made POS show a slightly different price. */
export function AddVariantForm({
  parentSku, colorCodes, effRetail, effWholesale, effMrp,
}: {
  parentSku: string;
  colorCodes: Record<string, string>;
  effRetail: number | null;   // rupees, product's effective price (placeholder hint)
  effWholesale: number | null;
  effMrp: number | null;
}) {
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [polish, setPolish] = useState("");
  const [sku, setSku] = useState("");

  const auto = previewSku(parentSku, color, size, polish, colorCodes);
  const shownSku = sku.trim() || auto;
  const rs = (n: number | null) => (n != null ? `same as product · ₹${n.toLocaleString("en-IN")}` : "auto");

  return (
    <div className="border-t border-sand/60 pt-4">
      <form action={addVariantAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="product_sku" value={parentSku} />
        <label className="text-[11px] text-muted">Colour<input name="color" value={color} onChange={(e) => setColor(e.target.value)} onBlur={() => setColor((v) => snapColorName(v))} list="opt-color" placeholder="e.g. Green" className={`${vInput} w-28 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Size<input name="size" value={size} onChange={(e) => setSize(e.target.value)} list="opt-size" placeholder="e.g. 2.6" className={`${vInput} w-24 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Polish<input name="polish" value={polish} onChange={(e) => setPolish(e.target.value)} list="opt-polish" placeholder="e.g. Oxidised" className={`${vInput} w-28 block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">SKU<input name="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="blank = auto" className={`${vInput} w-32 block mt-0.5 font-mono`} /></label>
        <label className="text-[11px] text-muted">Stock<input name="qty" type="number" min={0} defaultValue={0} className={`${vInput} w-14 text-center block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Retail ₹<input name="retail" type="number" min={0} step="0.01" placeholder={rs(effRetail)} className={`${vInput} w-40 text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Wholesale ₹<input name="wholesale" type="number" min={0} step="0.01" placeholder={rs(effWholesale)} className={`${vInput} w-40 text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">MRP ₹<input name="mrp" type="number" min={0} step="0.01" placeholder={rs(effMrp)} className={`${vInput} w-40 text-right block mt-0.5`} /></label>
        <button className="btn-primary px-4 py-2 text-sm font-medium">+ Add variant</button>
      </form>
      {(color || size || polish) && (
        <p className="mt-2 text-[11px] text-emerald-dark">
          Barcode SKU will be <span className="font-mono font-semibold">{shownSku}</span> — created automatically, you don&apos;t need to type it.
        </p>
      )}
      <p className="text-[11px] text-muted mt-1.5">
        At least one of colour / size / polish is required. <b>Leave the price boxes blank</b> and the colour uses the product&apos;s own price automatically (shown in grey) — only type a price if this colour should cost something different.
      </p>
    </div>
  );
}
