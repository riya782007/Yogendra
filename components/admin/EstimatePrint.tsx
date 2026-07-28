"use client";
import { useState } from "react";

/**
 * Print the estimate at the chosen paper size.
 *  - A4 = the current, correct layout — completely untouched (no style injected at all).
 *  - A5 = the SAME A4 bill shrunk to the exact A5:A4 ratio (148/210 = 0.7047) with CSS `zoom`.
 *    We use `zoom` (not `transform: scale`) on purpose: `zoom` shrinks the actual LAYOUT box, so the
 *    browser re-paginates correctly — a long multi-item bill flows across multiple A5 pages, each full,
 *    and a short bill fits on one. The old `transform: scale` + `position: fixed` approach did NOT
 *    change the layout box or paginate, so any bill longer than one page printed blank / clipped pages.
 */
const A5_OVER_A4 = 148 / 210; // 0.7047 — A5 width ÷ A4 width; margin:0 makes the shrunk width fit A5 exactly

export function EstimatePrint() {
  const [size, setSize] = useState<"A4" | "A5">("A4");

  function doPrint() {
    let el: HTMLStyleElement | null = null;
    if (size === "A5") {
      el = document.createElement("style");
      el.setAttribute("data-estimate-print", "1");
      // margin:0 so the 0.7047-shrunk A4 width (=148mm) fills the A5 width exactly with no clipping.
      el.textContent =
        `@media print{` +
        `@page{ size:A5 portrait; margin:0 }` +
        `html,body{ margin:0 !important }` +
        `.print-area{` +
        `zoom:${A5_OVER_A4};` +
        `margin:0 !important; border-radius:0 !important; box-shadow:none !important;` +
        `}}`;
      // Append to <body> (not <head>) so this @page A5 rule comes AFTER the estimate page's static
      // @page A4 block in document order and therefore wins the cascade when A5 is chosen. In <head>
      // it lost to the body-level A4 style and A5 silently printed as A4.
      document.body.appendChild(el);
    }
    window.print();
    setTimeout(() => { el?.remove(); }, 800);
  }

  return (
    <div className="flex items-center gap-2 no-print">
      <label className="text-xs text-muted flex items-center gap-1">Page
        <select value={size} onChange={(e) => setSize(e.target.value as "A4" | "A5")}
          className="rounded-full border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald">
          <option value="A4">A4</option>
          <option value="A5">A5</option>
        </select>
      </label>
      <button onClick={doPrint} className="btn-primary px-5 py-2.5 text-sm font-medium">⎙ Print PDF</button>
    </div>
  );
}
