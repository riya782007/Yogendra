"use client";

/** Screen-only toolbar for the printable line-sheet: one-click "Save as PDF" (browser print). */
export function LineSheetToolbar({ count }: { count: number }) {
  return (
    <div className="print:hidden sticky top-0 z-10 -mx-5 mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-sand bg-cream/90 px-5 py-3 backdrop-blur">
      <p className="text-sm text-muted">{count} designs · trade rates</p>
      <div className="flex items-center gap-2">
        <a href="/trade" className="text-sm text-muted hover:text-ink">← Back to portal</a>
        <button onClick={() => window.print()} className="btn-gold px-5 py-2 text-sm font-medium">Save as PDF / Print</button>
      </div>
    </div>
  );
}
