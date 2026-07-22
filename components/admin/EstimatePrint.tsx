"use client";
import { useState } from "react";

/**
 * Print the estimate at the chosen paper size.
 *  - A4 = the current, correct layout — completely untouched.
 *  - A5 = the SAME bill scaled to fit ONE A5 sheet instead of splitting across two. A5 is half of A4,
 *    so a ~0.70 zoom on the print area fits it exactly; `zoom` reflows + repaginates in Chrome so it
 *    never overflows to a second page. Nothing else about the bill changes.
 */
export function EstimatePrint() {
  const [size, setSize] = useState<"A4" | "A5">("A4");

  function doPrint() {
    let el: HTMLStyleElement | null = null;
    if (size === "A5") {
      el = document.createElement("style");
      el.setAttribute("data-estimate-print", "1");
      el.textContent = "@media print{ @page{ size:A5; margin:8mm } .print-area{ zoom:0.70 } }";
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
