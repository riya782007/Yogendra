"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateTradeVisitorAction } from "@/app/actions/leads";
import { LeadMessageComposer } from "@/components/admin/LeadMessageComposer";
import { phoneDigits } from "@/lib/phone";

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
  const tel = phoneDigits(v.phone);

  async function setStatus(status: string) {
    setBusy(true);
    await updateTradeVisitorAction({ id: v.id, status });
    setBusy(false);
    router.refresh();
  }

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
            {v.phone ? <a href={`tel:${tel}`} className="hover:text-emerald">{v.phone}</a> : "no number"}
            {v.city ? <span className="text-muted"> · {v.city}</span> : null}
          </p>
          <p className="text-xs text-muted mt-1">
            Viewed ~{v.designs_viewed ?? 0} designs{mins > 0 ? ` · ${mins} min on site` : ""}
            {v.trigger_reason && WHY[v.trigger_reason] ? ` · ${WHY[v.trigger_reason]}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <LeadMessageComposer lead={{ name: v.name, phone: v.phone, city: v.city, designsViewed: v.designs_viewed }} />
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
