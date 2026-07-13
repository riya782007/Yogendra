/**
 * OrderTimeline — customer-facing order status stepper (Placed → Confirmed → Dispatched → Delivered),
 * driven by the real order status. Shows courier + tracking link once the order is dispatched.
 * Server component (no client JS).
 */
import { TRACK_STEPS, orderTrackStep, type OrderLike } from "@/lib/orderStatus";

export function OrderTimeline({ order }: { order?: OrderLike }) {
  const { index, cancelled } = orderTrackStep(order ?? {});

  if (cancelled) {
    return (
      <div className="rounded-2xl border border-rose/30 bg-rose/5 p-5 text-center">
        <p className="text-rose font-medium">This order was cancelled</p>
        <p className="text-xs text-muted mt-1">Any payment made will be refunded. Questions? Message us on WhatsApp.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        {TRACK_STEPS.map((step, i) => {
          const done = i <= index;
          const current = i === index;
          return (
            <div key={step} className="flex-1 flex items-center">
              <div className="flex flex-col items-center">
                <div className={`h-8 w-8 rounded-full grid place-items-center text-sm ${done ? "bg-emerald text-white" : "bg-cream text-muted border border-sand"} ${current ? "ring-2 ring-emerald/40" : ""}`}>
                  {done ? "✓" : i + 1}
                </div>
                <span className={`text-[11px] mt-1 ${done ? "text-emerald" : "text-muted"}`}>{step}</span>
              </div>
              {i < TRACK_STEPS.length - 1 && <div className={`flex-1 h-0.5 mx-1 ${i < index ? "bg-emerald/40" : "bg-sand"}`} />}
            </div>
          );
        })}
      </div>

      {index >= 2 && (order?.tracking_no || order?.tracking_url || order?.courier_name) ? (
        <div className="mt-4 rounded-xl bg-cream/70 px-4 py-3 text-sm">
          {order?.courier_name && <p className="text-ink">Courier: <b>{order.courier_name}</b></p>}
          {order?.tracking_no && <p className="text-ink">Tracking no: <b className="font-mono">{order.tracking_no}</b></p>}
          {order?.tracking_url && (
            <a href={order.tracking_url} target="_blank" rel="noreferrer" className="inline-block mt-1 text-emerald-dark font-medium underline">
              Track on courier site →
            </a>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted mt-4 text-center">
          {index >= 3 ? "Delivered — thank you for shopping with us! 💛" : "We'll send tracking on WhatsApp the moment your order ships."}
        </p>
      )}
    </div>
  );
}
