"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOpenReturnAction } from "@/app/actions/openReturns";

type Line = { sku: string; qty: number };

/**
 * Goods back WITHOUT a bill — the marketplace case (sold to Myntra, returned 15-20 days later, mixed
 * across invoices). Scan or type the SKUs, say how many came back, and the stock goes straight back on
 * the shelf with a proper ledger entry. Money is optional because these are usually credit notes.
 */
export function OpenReturnClient({ methods = [] }: { methods?: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ sku: "", qty: 1 }]);
  const [party, setParty] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [methodId, setMethodId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const inp = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
  const setLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await createOpenReturnAction({
      lines: lines.filter((l) => l.sku.trim() && l.qty > 0),
      party, reason,
      amountRupees: Number(amount) || 0,
      refundFromMethodId: (Number(amount) || 0) > 0 ? methodId || undefined : undefined,
    });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Could not record the return.", ok: false }); return; }
    const skipped = r.skipped?.length ? ` · ${r.skipped.length} SKU(s) not found: ${r.skipped.join(", ")}` : "";
    setMsg({ text: `Return recorded ✓ ${r.restocked} pcs back in stock${skipped}`, ok: !r.skipped?.length });
    setLines([{ sku: "", qty: 1 }]); setParty(""); setReason(""); setAmount("");
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-4 px-4 py-2 rounded-full border border-gold text-gold-dark text-sm font-medium hover:bg-gold/10">
        ↩ Return without a bill (marketplace / mixed stock)
      </button>
    );
  }

  return (
    <div className="mb-6 bg-white rounded-2xl shadow-card p-5 border border-gold/40">
      <h2 className="font-medium text-ink">Return without a bill</h2>
      <p className="text-xs text-muted mt-0.5 mb-4">
        For stock coming back that can&apos;t be tied to one invoice — marketplace returns, mixed cartons,
        old sales. Pieces go back on the shelf and the movement is logged, exactly like a normal return.
        Leave the amount blank if this is a credit note rather than cash returned.
      </p>

      <div className="space-y-2 mb-3">
        {lines.map((l, i) => (
          <div key={i} className="flex items-end gap-2">
            <label className="text-[11px] text-muted flex-1">SKU
              <input value={l.sku} onChange={(e) => setLine(i, { sku: e.target.value })} placeholder="BR1821-Golden"
                className={`${inp} w-full block mt-0.5 font-mono`} />
            </label>
            <label className="text-[11px] text-muted">Qty back
              <input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                className={`${inp} w-20 text-center block mt-0.5`} />
            </label>
            {lines.length > 1 && <button onClick={() => setLines((p) => p.filter((_, k) => k !== i))} className="text-muted hover:text-rose text-xs pb-2">✕</button>}
          </div>
        ))}
        <button onClick={() => setLines((p) => [...p, { sku: "", qty: 1 }])} className="text-xs text-emerald nav-link">+ Add another item</button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-sand/60 pt-3">
        <label className="text-[11px] text-muted">Returned by
          <input value={party} onChange={(e) => setParty(e.target.value)} placeholder="Myntra / customer name" className={`${inp} w-44 block mt-0.5`} />
        </label>
        <label className="text-[11px] text-muted">Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Unsold stock returned" className={`${inp} w-52 block mt-0.5`} />
        </label>
        <label className="text-[11px] text-muted">Credit / refund ₹ <span className="text-muted">(optional)</span>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className={`${inp} w-28 text-right block mt-0.5`} />
        </label>
        {(Number(amount) || 0) > 0 && methods.length > 0 && (
          <label className="text-[11px] text-muted">Paid back from
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={`${inp} w-40 block mt-0.5`}>
              <option value="">Credit note only (no cash)</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <button onClick={submit} disabled={busy} className="btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? "Recording…" : "Record return"}
        </button>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="px-3 py-2 text-xs text-muted hover:text-ink">Close</button>
      </div>

      {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
    </div>
  );
}
