"use client";
import { useState } from "react";

/**
 * Print the estimate DETERMINISTICALLY, so a direct print to a physical printer and a "Save as PDF"
 * produce the EXACT same pages every time — and it never quietly falls back to the printer's own paper
 * defaults again.
 *
 * WHY AN ISOLATED IFRAME (not `window.print()` on the live page):
 *  The estimate lives inside the heavy admin shell (sidebar, sticky bars, full-height background, its own
 *  print CSS). When we asked the browser to print that whole page, the physical-printer path kept
 *  re-flowing the bill (a 3-page quote ballooned to ~8 sheets) while "Save as PDF" happened to use tighter
 *  defaults — the two disagreed and the "fix" regressed. Instead we now clone ONLY the estimate document
 *  into a hidden, self-contained iframe together with the page's real stylesheets (so it still looks
 *  identical) plus one locked @page rule, and print THAT. Nothing from the admin shell — and none of the
 *  printer's paper guessing — can touch it, so A4 and A5 are pixel-stable across every print destination.
 *
 *  A5 = the same A4 document shrunk to the exact A5:A4 width ratio with CSS `zoom` (shrinks the real
 *  layout box, so a long bill re-paginates and fills each A5 sheet rather than clipping).
 */
const A5_OVER_A4 = 148 / 210; // 0.7047 — A5 width ÷ A4 width

export function EstimatePrint() {
  const [size, setSize] = useState<"A4" | "A5">("A4");
  const [busy, setBusy] = useState(false);

  function doPrint() {
    const src = document.getElementById("estimate"); // the .print-area estimate document
    if (!src) { window.print(); return; }
    setBusy(true);

    // Clone the page's REAL stylesheets (Next.js CSS + Tailwind) so the bill looks identical inside the
    // iframe — otherwise every Tailwind class would be unstyled.
    const styleTags = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((n) => n.outerHTML)
      .join("\n");

    const isA5 = size === "A5";
    const lock = `
      @page { size: ${isA5 ? "A5" : "A4"} portrait; margin: ${isA5 ? "0" : "9mm"}; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
      /* The document card: strip screen chrome (shadow/rounded/padding) so it prints edge-clean. */
      .print-area { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important; ${isA5 ? `zoom: ${A5_OVER_A4};` : ""} }
      .no-print { display: none !important; }
      /* keep rows whole and repeat the table header across pages */
      table { border-collapse: collapse; }
      tr { page-break-inside: avoid; }
      thead { display: table-header-group; }
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    `;

    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(iframe);

    const cw = iframe.contentWindow!;
    const doc = cw.document;
    doc.open();
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>Estimate</title>` +
      styleTags +
      `<style>${lock}</style>` +
      `</head><body>${src.outerHTML}</body></html>`
    );
    doc.close();

    // Give the cloned stylesheets (and web fonts) a moment to load in the iframe before printing, then
    // clean up. window.print() blocks in Chrome until the dialog closes, so removal happens afterwards.
    const fire = () => {
      try { cw.focus(); cw.print(); } catch { /* ignore */ }
      setTimeout(() => { iframe.remove(); setBusy(false); }, 500);
    };
    // Prefer the load event; fall back to a timeout in case it already fired for document.write content.
    let fired = false;
    const go = () => { if (fired) return; fired = true; fire(); };
    iframe.onload = () => setTimeout(go, 250);
    setTimeout(go, 900);
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
      <button onClick={doPrint} disabled={busy} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-60">
        {busy ? "Preparing…" : "⎙ Print PDF"}
      </button>
    </div>
  );
}
