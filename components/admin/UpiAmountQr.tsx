/**
 * UpiAmountQr — a scan-to-pay UPI QR for an EXACT amount (bills & estimates). Encodes a standard UPI
 * deep link (upi://pay?...&am=<amount>) so any UPI app pre-fills the payee + amount. No build dependency:
 * the QR bitmap is rendered by the public QR image endpoint from the deterministic UPI string.
 */
export function UpiAmountQr({
  upiId, payeeName, amountPaise, note, size = 170,
}: { upiId?: string | null; payeeName?: string | null; amountPaise: number; note?: string; size?: number }) {
  if (!upiId || amountPaise <= 0) return null;
  const amt = (amountPaise / 100).toFixed(2);
  const upi = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName || "Blythe Diva")}&am=${amt}&cu=INR${note ? `&tn=${encodeURIComponent(note)}` : ""}`;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=0&data=${encodeURIComponent(upi)}`;
  const rupees = "₹" + Math.round(amountPaise / 100).toLocaleString("en-IN");
  return (
    <div className="text-center print:break-inside-avoid">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt={`Scan to pay ${rupees}`} width={size} height={size} className="mx-auto rounded-lg border border-sand bg-white p-1.5" />
      <p className="text-xs text-muted mt-1.5">Scan &amp; pay <b className="text-ink">{rupees}</b></p>
      <p className="text-[11px] text-muted">UPI: <span className="font-mono">{upiId}</span></p>
    </div>
  );
}
