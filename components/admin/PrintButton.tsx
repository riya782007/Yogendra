"use client";
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="btn-primary px-5 py-2.5 text-sm font-medium no-print">
      ⎙ Download / Print PDF
    </button>
  );
}
