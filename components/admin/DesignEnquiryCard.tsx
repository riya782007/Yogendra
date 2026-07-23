"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateDesignEnquiryAction } from "@/app/actions/enquiries";

type Enq = {
  id: string; created_at: string; sku: string | null; product_name: string | null;
  dealer_name: string | null; dealer_phone: string | null; mode: string; note: string | null;
  status: string; admin_note: string | null;
};

const MODE_LABEL: Record<string, string> = {
  video_call: "📹 Wants a video call",
  store_visit: "🏬 Wants to visit the store",
  whatsapp: "💬 Wants photos on WhatsApp",
};

const agoText = (d: string) => {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

/** One dealer asking to see a design's full colour range. The owner calls/messages, then marks it done. */
export function DesignEnquiryCard({ e }: { e: Enq }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  let phone = e.dealer_phone ? String(e.dealer_phone).replace(/\D/g, "") : "";
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (phone.length === 10) phone = "91" + phone; // country code so WhatsApp opens the right chat

  async function setStatus(status: string) {
    setBusy(true);
    await updateDesignEnquiryAction({ id: e.id, status });
    setBusy(false);
    router.refresh();
  }

  const waText =
    `Hi ${e.dealer_name || "there"}! Thanks for your interest in ${e.product_name ?? e.sku ?? "our designs"}.` +
    ` We have many more colours in this design. ` +
    (e.mode === "video_call" ? "When would suit you for a quick video call? We'll show you the full range live."
      : e.mode === "store_visit" ? "You're welcome at our Sadar Bazar store any day 11am–7pm — tell us when you'd like to come."
      : "Sending you photos of the remaining designs now.");
  const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waText)}` : null;

  const isNew = e.status === "new";
  const chip = isNew ? "bg-gold/15 text-gold-dark" : e.status === "contacted" ? "bg-emerald-mist text-emerald-dark" : "bg-ink/5 text-muted";

  return (
    <div className={`bg-white rounded-2xl p-5 shadow-card ${isNew ? "ring-1 ring-gold/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {e.dealer_name || "Dealer"}
            <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full align-middle ${chip}`}>{e.status.toUpperCase()}</span>
            <span className="text-xs text-muted"> · {agoText(e.created_at)}</span>
          </p>
          <p className="text-sm text-ink mt-1">{MODE_LABEL[e.mode] ?? e.mode}</p>
          <p className="text-xs text-muted mt-0.5">
            {e.product_name ?? "—"} {e.sku && <span className="font-mono">· {e.sku}</span>}
          </p>
          {e.note && <p className="text-xs text-ink mt-1.5 rounded-lg bg-cream/60 px-2 py-1.5">“{e.note}”</p>}
          {e.dealer_phone && <p className="text-xs text-muted mt-1"><a href={`tel:${phone}`} className="hover:text-emerald">{e.dealer_phone}</a></p>}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs font-medium">WhatsApp reply →</a>}
          <div className="flex gap-1.5">
            {e.status !== "contacted" && <button onClick={() => setStatus("contacted")} disabled={busy} className="px-2.5 py-1 rounded-full border border-emerald text-emerald-dark text-[11px] disabled:opacity-50">Mark contacted</button>}
            {e.status !== "closed" && <button onClick={() => setStatus("closed")} disabled={busy} className="px-2.5 py-1 rounded-full border border-sand text-muted text-[11px] disabled:opacity-50">Close</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
