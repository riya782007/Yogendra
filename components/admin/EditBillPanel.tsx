"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOrderForEditAction, saveOrderBillAction, type EditableBill } from "@/app/actions/billing";
import { SkuInput } from "@/components/admin/SkuInput";
import { GST_RATE } from "@/lib/business";
import { orderPayablePaise, orderStoredTotalPaise, taxFromBill, type BillTax } from "@/lib/orderBill";

type Line = { id: string; name: string; sku: string; qty: number; priceRupees: number };
type NewItem = { sku: string; qty: number; priceRupees: string };
type Charges = { packing: number; courier: number; adjustment: number };
type Cust = { name: string; phone: string; gstin: string; address: string };

function billToState(bill: EditableBill) {
  return {
    lines: bill.items.map((it) => ({
      id: it.id, name: it.name, sku: it.sku, qty: it.qty, priceRupees: (it.unit_price ?? 0) / 100,
    })),
    charges: {
      packing: (bill.extra_packing ?? 0) / 100,
      courier: (bill.extra_courier ?? 0) / 100,
      adjustment: (bill.extra_adjustment ?? 0) / 100,
    } as Charges,
    tax: taxFromBill(bill.bill_type, bill.gst_mode),
    cust: {
      name: bill.customer_name ?? "", phone: bill.customer_phone ?? "",
      gstin: bill.buyer_gstin ?? "", address: bill.buyer_address ?? "",
    } as Cust,
    invoice: bill.invoice_no ?? "",
    held: !!bill.cod_hold || !!bill.is_backorder,
    channel: bill.channel,
  };
}

/**
 * Edit a bill the same way it is created: one screen for customer, lines, packing/courier and GST,
 * then a single Save. Matches the estimate editor the owner already liked — not the old OTP-per-line
 * quantity panel that felt complicated.
 */
export function EditBillPanel({ orderId, initialBill }: { orderId: string; initialBill?: EditableBill }) {
  const router = useRouter();
  const seed = initialBill ? billToState(initialBill) : null;
  const [open, setOpen] = useState(!!initialBill);
  const [lines, setLines] = useState<Line[]>(seed?.lines ?? []);
  const [removeIds, setRemoveIds] = useState<string[]>([]);
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [charges, setCharges] = useState<Charges>(seed?.charges ?? { packing: 0, courier: 0, adjustment: 0 });
  const [tax, setTax] = useState<BillTax>(seed?.tax ?? "inclusive");
  const [cust, setCust] = useState<Cust>(seed?.cust ?? { name: "", phone: "", gstin: "", address: "" });
  const [invoice, setInvoice] = useState(seed?.invoice ?? "");
  const [held, setHeld] = useState(seed?.held ?? true);
  const [channel, setChannel] = useState<string | null>(seed?.channel ?? null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
  const num = (v: unknown) => Number(v) || 0;
  const money = (r: number) => "₹" + Math.round(r).toLocaleString("en-IN");

  const setLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const dropLine = (i: number) => setLines((p) => {
    const l = p[i]; if (l?.id) setRemoveIds((r) => [...r, l.id]);
    return p.filter((_, k) => k !== i);
  });
  const setNew = (i: number, patch: Partial<NewItem>) => setNewItems((p) => p.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const setC = (patch: Partial<Cust>) => setCust((c) => ({ ...c, ...patch }));
  const setCh = (patch: Partial<Charges>) => setCharges((c) => ({ ...c, ...patch }));

  function applyBill(bill: EditableBill) {
    const s = billToState(bill);
    setLines(s.lines); setCharges(s.charges); setTax(s.tax); setCust(s.cust);
    setInvoice(s.invoice); setHeld(s.held); setChannel(s.channel);
    setRemoveIds([]); setNewItems([]);
  }

  const itemsTotal = useMemo(() =>
    lines.reduce((s, l) => s + num(l.qty) * num(l.priceRupees), 0) +
    newItems.reduce((s, n) => s + num(n.qty) * num(n.priceRupees), 0),
    [lines, newItems]);
  const storedPaise = orderStoredTotalPaise({
    itemsPaise: Math.round(itemsTotal * 100),
    packingPaise: Math.round(num(charges.packing) * 100),
    courierPaise: Math.round(num(charges.courier) * 100),
    adjustmentPaise: Math.round(num(charges.adjustment) * 100),
    channel,
    billType: tax === "none" ? "cash" : "gst",
  });
  const payablePaise = orderPayablePaise(storedPaise, tax, GST_RATE);
  const gstAmt = Math.max(0, payablePaise - storedPaise);

  async function load() {
    setBusy(true); setMsg(null);
    const r = await fetchOrderForEditAction(orderId);
    setBusy(false);
    if (!r.ok || !r.bill) { setMsg({ text: r.error ?? "Couldn't load the bill.", ok: false }); return; }
    applyBill(r.bill);
    setOpen(true);
  }

  async function saveAll() {
    setBusy(true); setMsg(null);
    const r = await saveOrderBillAction({
      orderId,
      otp: otp.trim() || undefined,
      lines: lines.map((l) => ({ id: l.id, qty: Math.max(1, Math.floor(num(l.qty) || 1)), priceRupees: num(l.priceRupees) })),
      removeIds,
      newItems: newItems.filter((n) => n.sku.trim()).map((n) => ({
        sku: n.sku.trim(), qty: Math.max(1, Math.floor(num(n.qty) || 1)),
        priceRupees: n.priceRupees.trim() === "" ? undefined : num(n.priceRupees),
      })),
      charges: { packing: num(charges.packing), courier: num(charges.courier), adjustment: num(charges.adjustment) },
      tax,
      customer: { ...cust },
    });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't save.", ok: false }); return; }
    setMsg({ text: "Saved ✓ — bill updated.", ok: true });
    const fresh = await fetchOrderForEditAction(orderId);
    if (fresh.ok && fresh.bill) applyBill(fresh.bill);
    router.refresh();
  }

  if (!open) {
    return (
      <div id="edit-bill" className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="font-medium text-ink mb-1">✎ Edit this bill</h2>
        <p className="text-xs text-muted mb-3">Opens the same form used to make a bill — change items, packing, courier and GST, then save once.</p>
        <button onClick={load} disabled={busy} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">{busy ? "Loading…" : "Edit bill →"}</button>
        {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div id="edit-bill" className="bg-white rounded-2xl p-5 shadow-card sm:col-span-2 ring-1 ring-emerald/20 scroll-mt-4">
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="font-medium text-ink">Edit bill {invoice} — same form as creating a bill</h2>
        <button onClick={() => { setOpen(false); setOtp(""); setMsg(null); }} className="text-muted hover:text-ink text-sm shrink-0">Close ✕</button>
      </div>
      <p className="text-xs text-muted mb-4">Change any rate or quantity, add or remove items, set packing / courier and GST — then press <b>Save all changes</b> once.{held ? " This order is still held (COD / backorder), so stock has not moved yet." : ""}</p>

      {!held && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <label className="text-xs text-muted">Owner OTP <span className="text-muted font-normal">(staff only — owner can skip)</span></label>
          <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="● ● ● ● ● ●"
            className="rounded-lg border border-sand px-3 py-1.5 text-sm w-32 tracking-widest outline-none focus:border-emerald" />
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-2 mb-4">
        <label className="text-[11px] text-muted">Customer / firm<input value={cust.name} onChange={(e) => setC({ name: e.target.value })} className={`${inp} w-full mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Phone<input value={cust.phone} onChange={(e) => setC({ phone: e.target.value })} className={`${inp} w-full mt-0.5`} /></label>
        <label className="text-[11px] text-muted">GST on this bill
          <select value={tax} onChange={(e) => setTax(e.target.value as BillTax)} className={`${inp} w-full mt-0.5`}>
            <option value="none">No GST — cash memo</option>
            <option value="exclusive">Add GST {GST_RATE}% (extra)</option>
            <option value="inclusive">GST {GST_RATE}% included in price</option>
          </select>
        </label>
        <label className="text-[11px] text-muted">Buyer GSTIN<input value={cust.gstin} onChange={(e) => setC({ gstin: e.target.value.toUpperCase() })} placeholder="07AAAAA0000A1Z5" className={`${inp} w-full mt-0.5 font-mono uppercase`} /></label>
        <label className="text-[11px] text-muted sm:col-span-2">Billing / delivery address<input value={cust.address} onChange={(e) => setC({ address: e.target.value })} className={`${inp} w-full mt-0.5`} /></label>
      </div>

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

      <div className="grid grid-cols-3 gap-2 mt-4 border-t border-sand/60 pt-3">
        <label className="text-[11px] text-muted">Packing ₹<input type="number" min={0} step="0.01" value={charges.packing} onChange={(e) => setCh({ packing: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Courier ₹<input type="number" min={0} step="0.01" value={charges.courier} onChange={(e) => setCh({ courier: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
        <label className="text-[11px] text-muted">Adjust ± ₹<input type="number" step="0.01" value={charges.adjustment} onChange={(e) => setCh({ adjustment: num(e.target.value) })} className={`${inp} w-full text-right block mt-0.5`} /></label>
      </div>

      <div className="flex items-center justify-between mt-4 border-t border-sand pt-3">
        <div className="text-sm text-muted">
          {tax === "exclusive" && <p className="text-xs">Subtotal {money(storedPaise / 100)} + GST {money(gstAmt / 100)}</p>}
          {tax === "inclusive" && <p className="text-xs">Price includes {GST_RATE}% GST</p>}
          {tax === "none" && <p className="text-xs">Cash memo — no GST</p>}
        </div>
        <span className="font-semibold text-ink text-lg tabular-nums">{money(payablePaise / 100)}</span>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={saveAll} disabled={busy} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Saving…" : "Save all changes"}</button>
        {msg && <span className={`text-sm ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
