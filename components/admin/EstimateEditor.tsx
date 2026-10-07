"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveEstimateAction } from "@/app/actions/billing";
import { SkuInput } from "@/components/admin/SkuInput";

type Line = { id: string; name: string; sku: string; qty: number; priceRupees: number };
type NewItem = { sku: string; qty: number; priceRupees: string };
type Charges = { discount: number; packing: number; courier: number; tcs: number; adjustment: number };
type Cust = { name: string; phone: string; gstin: string; address: string; email: string; shipName: string; shipAddr: string };

/**
 * The whole open estimate on ONE editable screen (owner wanted a Vyapar-style full bill edit). Change
 * any line's rate or quantity, add/remove items (with the searchable SKU box), set courier/packing/
 * discount, edit the customer + tax — then press "Save all changes" once. Live total updates as you go.
 */
type EditorProps = {
  estimateId: string;
  initialLines: Line[];
  initialCharges: Charges;
  initialTax: "none" | "inclusive" | "exclusive";
  initialCustomer: Cust;
};

/**
 * Owner (Oct 2026): "estimate edit krke save kro to wo save hoke wha se hat jana chahiye, jaise supplier
 * banate waqt hota hai — warna confusion hota hai ki save hua ya nahi aur do baar save kar dete hain."
 *
 * So a successful save now CLOSES the edit panel and leaves a clear "Saved at 6:42 pm" card with an
 * "Edit again" button, and scrolls back up to the estimate, which already shows the new figures.
 * "Edit again" re-opens a FRESH editor from the saved estimate (the old panel kept stale rows — a line
 * added in the first save didn't show in the editor until the page was reloaded). Save is also
 * disabled until something has actually been changed, so a second click can't re-save the same thing.
 */
export function EstimateEditor(props: EditorProps) {
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  if (savedAt) {
    return (
      <div id="edit-estimate" className="no-print mt-5 bg-emerald-mist rounded-2xl p-5 ring-1 ring-emerald/30 flex flex-wrap items-center justify-between gap-3 scroll-mt-4">
        <div>
          <p className="font-medium text-emerald-dark">✓ Estimate saved at {savedAt}</p>
          <p className="text-xs text-ink/70 mt-0.5">The estimate above already shows the changes — nothing more to do.</p>
        </div>
        <button onClick={() => { setSavedAt(null); setRound((r) => r + 1); }}
          className="px-4 py-2 rounded-full bg-white border border-emerald text-emerald-dark text-sm hover:bg-emerald/10">✎ Edit again</button>
      </div>
    );
  }
  return (
    <EstimateEditorForm key={round} {...props}
      onSaved={() => {
        setSavedAt(new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }));
        if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
      }} />
  );
}

function EstimateEditorForm({ estimateId, initialLines, initialCharges, initialTax, initialCustomer, onSaved }: EditorProps & { onSaved: () => void }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(initialLines);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [charges, setCharges] = useState<Charges>(initialCharges);
  const [tax, setTax] = useState(initialTax);
  const [cust, setCust] = useState<Cust>(initialCustomer);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
  const num = (v: any) => Number(v) || 0;
  const money = (r: number) => "₹" + Math.round(r).toLocaleString("en-IN");

  const setLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const dropLine = (i: number) => setLines((p) => {
    const l = p[i]; if (l?.id) setRemoveIds((r) => [...r, l.id]);
    return p.filter((_, k) => k !== i);
  });
  const setNew = (i: number, patch: Partial<NewItem>) => setNewItems((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setC = (patch: Partial<Cust>) => setCust((c) => ({ ...c, ...patch }));
  const setCh = (patch: Partial<Charges>) => setCharges((c) => ({ ...c, ...patch }));

  const itemsTotal = useMemo(() =>
    lines.reduce((s, l) => s + num(l.qty) * num(l.priceRupees), 0) +
    newItems.reduce((s, n) => s + num(n.qty) * num(n.priceRupees), 0),
    [lines, newItems]);
  const chgTotal = num(charges.packing) + num(charges.courier) + num(charges.tcs) + num(charges.adjustment) - num(charges.discount);
  const grand = Math.max(0, itemsTotal + chgTotal);
  // Total pieces (owner: "estimate me total quantity").
  const totalQty = lines.reduce((s, l) => s + num(l.qty), 0) + newItems.reduce((s, n) => s + (n.sku.trim() ? num(n.qty) : 0), 0);
  // Anything to save? Compared with what was loaded, so an untouched panel can't be saved twice.
  const dirty = useMemo(() =>
    removeIds.length > 0 || newItems.some((n) => n.sku.trim()) ||
    JSON.stringify(lines) !== JSON.stringify(initialLines) || JSON.stringify(charges) !== JSON.stringify(initialCharges) ||
    tax !== initialTax || JSON.stringify(cust) !== JSON.stringify(initialCustomer),
    [removeIds, newItems, lines, charges, tax, cust, initialLines, initialCharges, initialTax, initialCustomer]);

  async function saveAll() {
    setBusy(true); setMsg(null);
    const r = await saveEstimateAction({
      id: estimateId,
      lines: lines.map((l) => ({ id: l.id, qty: Math.max(1, Math.floor(num(l.qty) || 1)), priceRupees: num(l.priceRupees) })),
      removeIds,
      newItems: newItems.filter((n) => n.sku.trim()).map((n) => ({
        sku: n.sku.trim(), qty: Math.max(1, Math.floor(num(n.qty) || 1)),
        priceRupees: n.priceRupees.trim() === "" ? undefined : num(n.priceRupees),
      })),
      charges: { discount: num(charges.discount), packing: num(charges.packing), courier: num(charges.courier), tcs: num(charges.tcs), adjustment: num(charges.adjustment) },
      tax,
      customer: { ...cust },
    });
    if (!r.ok) { setBusy(false); setMsg({ text: r.error ?? "Couldn't save.", ok: false }); return; }
    router.refresh();
    onSaved();
  }

  return (
    <div id="edit-estimate" className="no-print mt-5 bg-white rounded-2xl shadow-card p-5 ring-1 ring-emerald/20 scroll-mt-4">
      <h2 className="font-medium text-ink mb-1">Edit estimate — whole bill, one screen</h2>
      <p className="text-xs text-muted mb-4">Change any rate or quantity, add or remove items, set courier / packing / discount and the customer — then press <b>Save all changes</b> once. It locks after billing.</p>

      {/* Customer + tax */}
      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        <label className="text-[11px] text-muted">Customer / firm<input value={cust.name} onChange={(e) => setC({ name: e.target.value })} className={`${inp} w-full mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Phone<input value={cust.phone} onChange={(e) => setC({ phone: e.target.value })} className={`${inp} w-full mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Tax on this estimate
          <select value={tax} onChange={(e) => setTax(e.target.value as any)} className={`${inp} w-full mt-0.5`}>
            <option value="exclusive">GST extra (added on top)</option>
            <option value="inclusive">GST included in rates</option>
            <option value="none">Without GST</option>
          </select>
        </label>
        <label className="text-[11px] text-muted">Buyer GSTIN<input value={cust.gstin} onChange={(e) => setC({ gstin: e.target.value })} placeholder="07AAAAA0000A1Z5" className={`${inp} w-full mt-0.5 font-mono uppercase`} /></label>
        <label className="text-[11px] text-muted sm:col-span-2">Billing address<input value={cust.address} onChange={(e) => setC({ address: e.target.value })} className={`${inp} w-full mt-0.5`} /></label>
      </div>

      {/* Line items */}
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={l.id} className="flex items-end gap-2">
            <span className="flex-1 min-w-0 text-sm text-ink truncate self-center">{l.name} <span className="text-muted font-mono text-xs">{l.sku}</span></span>
            <label className="text-[11px] text-muted">Qty<input type="number" min={1} value={l.qty} onChange={(e) => setLine(i, { qty: Math.max(1, num(e.target.value) || 1) })} className={`${inp} w-16 text-center block mt-0.5`} /></label>
            <label className="text-[11px] text-muted">Rate ₹<input type="number" min={0} step="0.01" value={l.priceRupees} onChange={(e) => setLine(i, { priceRupees: num(e.target.value) })} className={`${inp} w-24 text-right block mt-0.5`} /></label>
            <span className="text-sm text-ink self-center w-24 text-right tabular-nums shrink-0">{money(num(l.qty) * num(l.priceRupees))}</span>
            <button onClick={() => dropLine(i)} title="Remove" className="text-muted hover:text-rose text-sm px-1 pb-2">✕</button>
          </div>
        ))}

        {/* New item rows (searchable SKU) */}
        {newItems.map((n, i) => (
          <div key={`n${i}`} className="flex items-end gap-2">
            <div className="flex-1 min-w-0"><SkuInput value={n.sku} onChange={(v) => setNew(i, { sku: v })} placeholder="Type SKU or product name…" className={`${inp} w-full font-mono`} /></div>
            <label className="text-[11px] text-muted">Qty<input type="number" min={1} value={n.qty} onChange={(e) => setNew(i, { qty: Math.max(1, num(e.target.value) || 1) })} className={`${inp} w-16 text-center block mt-0.5`} /></label>
            <label className="text-[11px] text-muted">Rate ₹<input type="number" min={0} step="0.01" value={n.priceRupees} onChange={(e) => setNew(i, { priceRupees: e.target.value })} placeholder="auto" className={`${inp} w-24 text-right block mt-0.5`} /></label>
            <button onClick={() => setNewItems((p) => p.filter((_, k) => k !== i))} title="Remove" className="text-muted hover:text-rose text-sm px-1 pb-2">✕</button>
          </div>
        ))}
        {lines.length === 0 && newItems.length === 0 && <p className="text-sm text-muted">No items yet — add one below.</p>}
      </div>
      <button onClick={() => setNewItems((p) => [...p, { sku: "", qty: 1, priceRupees: "" }])} className="text-xs text-emerald nav-link mt-2">+ Add item</button>

      {/* Charges */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4 border-t border-sand/60 pt-3">
        <label className="text-[11px] text-muted">Discount ₹<input type="number" min={0} step="0.01" value={charges.discount} onChange={(e) => setCh({ discount: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Packing ₹<input type="number" min={0} step="0.01" value={charges.packing} onChange={(e) => setCh({ packing: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Courier ₹<input type="number" min={0} step="0.01" value={charges.courier} onChange={(e) => setCh({ courier: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">TCS ₹<input type="number" min={0} step="0.01" value={charges.tcs} onChange={(e) => setCh({ tcs: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Adjustment ₹<input type="number" step="0.01" value={charges.adjustment} onChange={(e) => setCh({ adjustment: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
      </div>

      {/* Total + single save */}
      <div className="flex items-center justify-between mt-4 border-t border-sand pt-3">
        <span className="text-sm text-muted">Estimate total{tax !== "exclusive" ? "" : " (before GST)"} · <b className="text-ink">{totalQty} pcs</b></span>
        <span className="font-semibold text-ink text-lg tabular-nums">{money(grand)}</span>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={saveAll} disabled={busy || !dirty} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Saving…" : dirty ? "Save all changes" : "No changes yet"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
