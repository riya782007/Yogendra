"use client";
import { useState } from "react";

/**
 * Print the estimate at the chosen paper size.
 *  - A4 = the current, correct layout — completely untouched (no style injected at all).
 *  - A5 = a TRUE shrunk photocopy of the A4 bill. The bill is still laid out at full A4 width (210mm)
 *    so every line break, column and spacing is byte-for-byte identical to A4, then the whole sheet is
 *    optically scaled down by the exact A5:A4 ratio (148/210 = 0.7047) with CSS `transform: scale`.
 *    Unlike `zoom`, `transform` does NOT reflow — it is a pure visual shrink, so A5 is literally A4
 *    photographed smaller. `position: fixed` lifts it out of page flow so it prints on exactly ONE A5
 *    sheet and can never spill onto a second page.
 */
const A5_OVER_A4 = 148 / 210; // 0.7047 — A5 is exactly half an A4; this is the width (and height) ratio

export function EstimatePrint() {
  const [size, setSize] = useState<"A4" | "A5">("A4");

  function doPrint() {
    let el: HTMLStyleElement | null = null;
    if (size === "A5") {
      el = document.createElement("style");
      el.setAttribute("data-estimate-print", "1");
      el.textContent =
        `@media print{` +
        `@page{ size:A5 portrait; margin:0 }` +
        `body{ margin:0 !important }` +
        `.print-area{` +
        `position:fixed; top:0; left:0;` +
        `width:210mm;` +                            /* render identical to A4… */
        `transform:scale(${A5_OVER_A4});` +         /* …then shrink the whole thing to A5 */
        `transform-origin:top left;` +
        `margin:0 !important; border-radius:0 !important; box-shadow:none !important;` +
        `}}`;
      document.head.appendChild(el);
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
