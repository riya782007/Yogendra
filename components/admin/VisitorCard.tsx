"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTradeVisitorAction } from "@/app/actions/leads";
import { SITE } from "@/lib/siteUrl";

type V = {
  id: string; created_at: string; name: string | null; phone: string | null; city: string | null;
  designs_viewed: number | null; active_seconds: number | null; trigger_reason: string | null;
  status: string; admin_note: string | null;
};

const agoText = (d: string) => {
  const h = Math.round((Date.now() - new Date(d).getTime()) / 3600000);
  return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

const WHY: Record<string, string> = {
  time: "spent real time on the catalogue",
  browsed: "scrolled deep through the designs",
  intent: "was picking colours / quantities",
};

/** One trade visitor who left their details. Shows how engaged they were, so the owner can prioritise. */
export function VisitorCard({ v }: { v: V }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  let phone = v.phone ? String(v.phone).replace(/\D/g, "") : "";
  if (phone.startsWith("0")) phone = phone.slice(1);
  if (phone.length === 10) phone = "91" + phone; // country code so WhatsApp opens the right chat

  async function setStatus(status: string) {
    setBusy(true);
    await updateTradeVisitorAction({ id: v.id, status });
    setBusy(false);
    router.refresh();
  }

  const waMsg = `Hi ${v.name || "there"}! 🙏 This is Blythe Diva. We noticed you browsed our wholesale catalogue but didn't finalise your order. We'd love to have you as a trade partner — just revisit the catalogue and place your order here:\n${SITE}/trade\n\nAnd if something held you back — pricing, minimum order, designs or colours — please do tell us, we'll make it work for you. What made you not order this time? Your feedback really helps. 🌸`;
  const wa = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waMsg)}` : null;

  const isNew = v.status === "new";
  const chip = isNew ? "bg-gold/15 text-gold-dark"
    : v.status === "approved" ? "bg-emerald-mist text-emerald-dark"
    : v.status === "ignored" ? "bg-ink/5 text-muted" : "bg-emerald-mist text-emerald-dark";
  const mins = Math.round((v.active_seconds ?? 0) / 60);

  return (
    <div className={`bg-white rounded-2xl p-5 shadow-card ${isNew ? "ring-1 ring-gold/40" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {v.name || "Unnamed"}
            <span className={`ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full align-middle ${chip}`}>{v.status.toUpperCase()}</span>
            <span className="text-xs text-muted"> · {agoText(v.created_at)}</span>
          </p>
          <p className="text-sm text-ink mt-1">
            {v.phone ? <a href={`tel:${phone}`} className="hover:text-emerald">{v.phone}</a> : "no number"}
            {v.city ? <span className="text-muted"> · {v.city}</span> : null}
          </p>
          <p className="text-xs text-muted mt-1">
            Viewed ~{v.designs_viewed ?? 0} designs{mins > 0 ? ` · ${mins} min on site` : ""}
            {v.trigger_reason && WHY[v.trigger_reason] ? ` · ${WHY[v.trigger_reason]}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {wa && <a href={wa} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs font-medium">WhatsApp →</a>}
          <div className="flex gap-1.5">
            {v.status !== "contacted" && <button onClick={() => setStatus("contacted")} disabled={busy} className="px-2.5 py-1 rounded-full border border-emerald text-emerald-dark text-[11px] disabled:opacity-50">Contacted</button>}
            {v.status !== "approved" && <button onClick={() => setStatus("approved")} disabled={busy} className="px-2.5 py-1 rounded-full border border-gold text-gold-dark text-[11px] disabled:opacity-50">Became dealer</button>}
            {v.status !== "ignored" && <button onClick={() => setStatus("ignored")} disabled={busy} className="px-2.5 py-1 rounded-full border border-sand text-muted text-[11px] disabled:opacity-50">Not relevant</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
