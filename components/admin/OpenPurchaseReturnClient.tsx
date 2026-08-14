"use client";
/**
 * Goods BACK TO THE SUPPLIER without picking a purchase bill — the purchase-side twin of
 * OpenReturnClient (sales / marketplace). Scan SKUs, set qty + rate, name the supplier; stock
 * leaves the shelf and a debit note opens so it can be printed / WhatsApp'd to the vendor.
 * Bill-linked purchase returns stay on PurchaseReturnClient / PurchaseReturnButton.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOpenPurchaseReturnAction, lookupPurchaseReturnSkuAction } from "@/app/actions/openReturns";
import { SkuInput } from "@/components/admin/SkuInput";
import { formatPaise } from "@/lib/pricing";

type Line = { sku: string; qty: number; unitCostRupees: string; hint?: string; onHand?: number };
type Supplier = { id: string; name: string; city?: string | null };

export function OpenPurchaseReturnClient({
  suppliers = [],
  methods = [],
}: {
  suppliers?: Supplier[];
  methods?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ sku: "", qty: 1, unitCostRupees: "" }]);
  const [supplierId, setSupplierId] = useState("");
  const [party, setParty] = useState("");
  const [reason, setReason] = useState("");
  const [methodId, setMethodId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const inp = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
  const setLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  async function onSku(i: number, sku: string) {
    setLine(i, { sku, hint: undefined });
    if (sku.trim().length < 2) return;
    const r = await lookupPurchaseReturnSkuAction(sku);
    if (!r.ok) { setLine(i, { sku, hint: r.error }); return; }
    const rupees = r.lastCostPaise ? String(r.lastCostPaise / 100) : "";
    const label = [r.name, r.color].filter(Boolean).join(" · ");
    setLines((p) => p.map((l, k) => k !== i ? l : ({
      ...l,
      sku: r.sku ?? sku,
      unitCostRupees: l.unitCostRupees || rupees,
      onHand: r.qty,
      hint: `${label}${r.qty != null ? ` · ${r.qty} in stock` : ""}`,
    })));
  }

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await createOpenPurchaseReturnAction({
      lines: lines.filter((l) => l.sku.trim() && l.qty > 0).map((l) => ({
        sku: l.sku, qty: l.qty, unitCostRupees: Number(l.unitCostRupees) || 0,
      })),
      supplierId: supplierId || undefined,
      party: party || undefined,
      reason,
      creditToMethodId: methodId || undefined,
    });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Could not record the return.", ok: false }); return; }
    if (r.returnId) { router.push(`/admin/returns/${r.returnId}`); return; }
    setMsg({ text: `Return recorded ✓ ${r.qty} pcs sent to supplier`, ok: true });
    router.refresh();
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mb-4 ml-0 sm:ml-3 px-4 py-2 rounded-full border border-rose/40 text-rose text-sm font-medium hover:bg-rose/5">
        ⇤ Return to supplier without a bill
      </button>
    );
  }

  const preview = lines.reduce((s, l) => s + (Number(l.unitCostRupees) || 0) * (l.qty || 0), 0);

  return (
    <div className="mb-6 bg-white rounded-2xl shadow-card p-5 border border-rose/30">
      <h2 className="font-medium text-ink">Purchase return without a bill</h2>
      <p className="text-xs text-muted mt-0.5 mb-4">
        For stock going back to the supplier that can&apos;t be tied to one purchase bill — mixed cartons,
        old lots, verbal replacements. Pieces leave the shelf (never more than what is on hand) and a
        debit note is created so you can print it or send it on WhatsApp. To return against a specific
        bill, use the form below instead.
      </p>

      <div className="space-y-2 mb-3">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="text-[11px] text-muted flex-1 min-w-[180px]">SKU
              <SkuInput value={l.sku} onChange={(v) => onSku(i, v)} placeholder="Type SKU or product name…"
                className={`${inp} w-full block mt-0.5 font-mono`} />
              {l.hint && <span className="block text-[10px] text-muted mt-0.5">{l.hint}</span>}
            </label>
            <label className="text-[11px] text-muted">Qty out
              <input type="number" min={1} max={l.onHand ?? undefined} value={l.qty}
                onChange={(e) => setLine(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                className={`${inp} w-20 text-center block mt-0.5`} />
            </label>
            <label className="text-[11px] text-muted">Rate ₹
              <input type="number" min={0} step="0.01" value={l.unitCostRupees}
                onChange={(e) => setLine(i, { unitCostRupees: e.target.value })}
                placeholder="last cost" className={`${inp} w-28 text-right block mt-0.5`} />
            </label>
            {lines.length > 1 && <button onClick={() => setLines((p) => p.filter((_, k) => k !== i))} className="text-muted hover:text-rose text-xs pb-2">✕</button>}
          </div>
        ))}
        <button onClick={() => setLines((p) => [...p, { sku: "", qty: 1, unitCostRupees: "" }])} className="text-xs text-emerald nav-link">+ Add another item</button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-sand/60 pt-3">
        <label className="text-[11px] text-muted">Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={`${inp} w-52 block mt-0.5`}>
            <option value="">Select supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-muted">Or type the name
          <input value={party} onChange={(e) => setParty(e.target.value)} placeholder="if not in the list" className={`${inp} w-44 block mt-0.5`} />
        </label>
        <label className="text-[11px] text-muted">Reason
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged / wrong goods / excess" className={`${inp} w-52 block mt-0.5`} />
        </label>
        {preview > 0 && methods.length > 0 && (
          <label className="text-[11px] text-muted">Cash/UPI received back
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={`${inp} w-44 block mt-0.5`}>
              <option value="">Debit note only (no cash)</option>
              {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
        )}
        <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-xl bg-rose text-white text-sm font-medium disabled:opacity-50">
          {busy ? "Recording…" : preview > 0 ? `Record return · ${formatPaise(Math.round(preview * 100))}` : "Record return"}
        </button>
        <button onClick={() => { setOpen(false); setMsg(null); }} className="px-3 py-2 text-xs text-muted hover:text-ink">Close</button>
      </div>

      {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
    </div>
  );
}
