"use client";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { generateReorderPlanAction, approveReorderAction, type Rec } from "@/app/actions/reorder";

const URG: Record<string, string> = { high: "bg-rose text-white", medium: "bg-gold/20 text-gold-dark", low: "bg-emerald-mist text-emerald-dark" };

export function ReorderClient({ candidateCount }: { candidateCount: number }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState("");
  const [recs, setRecs] = useState<Rec[]>([]);
  const [done, setDone] = useState<Record<string, boolean>>({});

  async function generate() {
    setBusy(true);
    const res = await generateReorderPlanAction();
    setBusy(false); setRecs(res.recs); setProvider(res.provider);
    if (res.recs.length === 0) toast("Inventory looks healthy — nothing to reorder ✦", "info");
  }
  async function approve(r: Rec) {
    await approveReorderAction({ sku: r.sku, name: r.name, action: r.action, qty: r.qty });
    setDone((d) => ({ ...d, [r.sku]: true }));
    toast(r.action === "clear" ? "Clearance flagged & assignee notified" : `Reorder noted & assignee notified`);
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-5">
        <button onClick={generate} disabled={busy} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-50">
          {busy ? "Thinking…" : "✨ Generate AI reorder plan"}
        </button>
        <span className="text-sm text-muted">{candidateCount} items need attention</span>
        {provider && <span className="text-xs text-muted">· drafted by {provider === "rules" ? "rule engine (no AI key)" : provider}</span>}
      </div>

      {recs.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          {recs.map((r) => (
            <div key={r.sku} className="bg-white rounded-2xl p-5 shadow-card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-ink">{r.name}</p>
                  <p className="text-xs text-muted">{r.sku} · {r.action === "clear" ? "Clearance" : `Reorder ${r.qty} pcs`}</p>
                </div>
                <span className={`text-[11px] px-2 py-1 rounded-full capitalize ${URG[r.urgency]}`}>{r.urgency}</span>
              </div>
              <p className="text-sm text-ink/75 mt-2">{r.rationale}</p>
              <button onClick={() => approve(r)} disabled={done[r.sku]}
                className="mt-3 px-4 py-1.5 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20 disabled:opacity-60">
                {done[r.sku] ? "✓ Notified" : "Approve & notify"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
