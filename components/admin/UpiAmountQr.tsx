import { qrSvgPath } from "@/lib/qrSvg";

/**
 * UpiAmountQr — a scan-to-pay UPI QR for an EXACT amount (bills & estimates). Encodes a standard UPI
 * deep link (upi://pay?...&am=<amount>) so any UPI app pre-fills the payee + amount. The QR is drawn
 * locally as inline SVG (lib/qrSvg.ts) — no network, no npm dependency — so it is always in the PDF.
 */
export function UpiAmountQr({
  upiId, payeeName, amountPaise, note, size = 170,
}: { upiId?: string | null; payeeName?: string | null; amountPaise: number; note?: string; size?: number }) {
  if (!upiId || amountPaise <= 0) return null;
  const amt = (amountPaise / 100).toFixed(2);
  const upi = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName || "Blythe Diva")}&am=${amt}&cu=INR${note ? `&tn=${encodeURIComponent(note)}` : ""}`;
  const rupees = "₹" + Math.round(amountPaise / 100).toLocaleString("en-IN");
  // Drawn INLINE (no external image), so it is always inside the printed/saved PDF. The old
  // api.qrserver.com <img> was often still loading when the estimate iframe printed → empty box.
  let qr: { d: string; viewBox: number } | null = null;
  try { qr = qrSvgPath(upi); } catch { qr = null; }
  return (
    <div className="text-center print:break-inside-avoid">
      {qr ? (
        <svg role="img" aria-label={`Scan to pay ${rupees}`} width={size} height={size} viewBox={`0 0 ${qr.viewBox} ${qr.viewBox}`}
          shapeRendering="crispEdges" className="mx-auto rounded-lg border border-sand bg-white p-1.5">
          <rect width={qr.viewBox} height={qr.viewBox} fill="#fff" />
          <path d={qr.d} fill="#000" />
        </svg>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(upi)}`}
          alt={`Scan to pay ${rupees}`} width={size} height={size} className="mx-auto rounded-lg border border-sand bg-white p-1.5" />
      )}
      <p className="text-xs text-muted mt-1.5">Scan &amp; pay <b className="text-ink">{rupees}</b></p>
      <p className="text-[11px] text-muted">UPI: <span className="font-mono">{upiId}</span></p>
    </div>
  );
}
