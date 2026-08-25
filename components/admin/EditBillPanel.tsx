"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  fetchOrderForEditAction,
  editOrderLineAction,
  addOrderLineAction,
} from "@/app/actions/billing";
import { editOrderChargesAction, fetchOrderChargesAction } from "@/app/actions/orderCharges";

type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; status: string; customer_name: string | null;
  extra_packing: number; extra_courier: number; extra_adjustment: number;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}
function paiseToInput(paise: number) {
  if (!paise) return "";
  const r = paise / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

/** OTP-gated bill editor: lines + packing/courier/adjustment (same as POS). */
export function EditBillPanel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bill, setBill] = useState<EditableBill | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  const [addSku, setAddSku] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addPrice, setAddPrice] = useState("");
  const [packing, setPacking] = useState("");
  const [courier, setCourier] = useState("");
  const [adjustment, setAdjustment] = useState("");

  function applyBill(fresh: EditableBill) {
    setBill(fresh);
    setQtyDraft(Object.fromEntries(fresh.items.map((it) => [it.id, String(it.qty)])));
    setPacking(paiseToInput(fresh.extra_packing ?? 0));
    setCourier(paiseToInput(fresh.extra_courier ?? 0));
    setAdjustment(paiseToInput(fresh.extra_adjustment ?? 0));
  }

  async function loadChargesOnto(bill: EditableBill) {
    const ch = await fetchOrderChargesAction(orderId);
    if (ch.ok) {
      bill.extra_packing = ch.packing ?? 0;
      bill.extra_courier = ch.courier ?? 0;
      bill.extra_adjustment = ch.adjustment ?? 0;
    }
    return bill;
  }

  async function reload() {
    const fresh = await fetchOrderForEditAction(orderId);
    if (fresh.ok && fresh.bill) {
      const b = await loadChargesOnto({
        ...(fresh.bill as EditableBill),
        extra_packing: 0, extra_courier: 0, extra_adjustment: 0,
      });
      applyBill(b);
    }
    router.refresh();
  }

  async function openPanel() {
    setBusy(true); setMsg(null);
    const r = await fetchOrderForEditAction(orderId);
    setBusy(false);
    if (r.ok && r.bill) {
      const b = await loadChargesOnto({
        ...(r.bill as EditableBill),
        extra_packing: 0, extra_courier: 0, extra_adjustment: 0,
      });
      applyBill(b);
      setOpen(true);
    } else {
      setMsg({ text: r.error ?? "Could not load bill.", ok: false });
    }
  }

  async function addLine() {
    if (!otp.trim()) { setMsg({ text: "Enter the owner OTP first.", ok: false }); return; }
    if (!addSku.trim()) { setMsg({ text: "Enter the SKU (with colour) to add.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await addOrderLineAction({
      orderId, sku: addSku.trim(), qty: Math.max(1, Number(addQty) || 1),
      priceRupees: addPrice.trim() === "" ? undefined : Number(addPrice),
      otp: otp.trim(),
    });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't add the item.", ok: false }); return; }
    setMsg({ text: `Added ${r.sku ?? addSku} ✓`, ok: true });
    setAddSku(""); setAddQty("1"); setAddPrice("");
    await reload();
  }

  async function save(itemId: string, newQty: number) {
    if (!otp.trim()) { setMsg({ text: "Enter the owner OTP first.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await editOrderLineAction({ orderId, itemId, newQty, otp: otp.trim() });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't save.", ok: false }); return; }
    setMsg({ text: r.removed ? "Line removed ✓" : "Quantity updated ✓", ok: true });
    await reload();
  }

  async function saveCharges() {
    if (!otp.trim()) { setMsg({ text: "Enter the owner OTP first.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await editOrderChargesAction({
      orderId,
      packingRupees: Number(packing) || 0,
      courierRupees: Number(courier) || 0,
      adjustmentRupees: Number(adjustment) || 0,
      otp: otp.trim(),
    });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't save charges.", ok: false }); return; }
    setMsg({ text: `Packing / courier saved ✓ · bill ${rupees(r.total ?? 0)}`, ok: true });
    await reload();
  }

  if (!open) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="font-medium text-ink mb-1">✎ Edit this bill <span className="text-xs text-muted font-normal">· owner OTP required</span></h2>
        <p className="text-xs text-muted mb-3">
          Fix qty / lines, packing & courier, or add the right SKU — same charge fields as POS.
          Stock & totals correct themselves; no need to cancel the whole bill.
        </p>
        <button type="button" onClick={openPanel} disabled={busy} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">
          {busy ? "Loading…" : "Edit bill →"}
        </button>
        {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card sm:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium text-ink">✎ Editing bill {bill?.invoice_no ?? ""}</h2>
        <button type="button" onClick={() => { setOpen(false); setOtp(""); setMsg(null); }} className="text-muted hover:text-ink text-sm">Close ✕</button>
      </div>
      <p className="text-xs text-muted mb-3">Lines, packing & courier (same as POS). OTP required for every save.</p>

      <label className="text-[11px] text-muted block mb-3">
        Owner OTP
        <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="••••••"
          className="rounded-lg border border-sand px-3 py-1.5 text-sm w-32 tracking-widest outline-none focus:border-emerald block mt-0.5" />
      </label>

      <div className="rounded-xl border border-sand/70 overflow-hidden mb-3">
        {(bill?.items ?? []).map((it) => (
          <div key={it.id} className="flex flex-wrap items-center gap-2 p-2.5 border-t border-sand/50 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink font-medium truncate">{it.name || it.sku}</p>
              <p className="text-[11px] text-muted font-mono">{it.sku} · {rupees(it.unit_price)} each · line {rupees(it.line_total)}</p>
            </div>
            <input type="number" min={0} value={qtyDraft[it.id] ?? String(it.qty)}
              onChange={(e) => setQtyDraft((d) => ({ ...d, [it.id]: e.target.value }))}
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-16 text-center outline-none focus:border-emerald" />
            <button type="button" onClick={() => save(it.id, Math.max(0, Math.floor(Number(qtyDraft[it.id] ?? it.qty))))} disabled={busy}
              className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs disabled:opacity-50">Save</button>
            <button type="button" onClick={() => save(it.id, 0)} disabled={busy}
              className="px-3 py-1.5 rounded-full border border-rose/40 text-rose text-xs hover:bg-rose/5 disabled:opacity-50">Remove</button>
          </div>
        ))}
        {(bill?.items ?? []).length === 0 && <p className="p-3 text-sm text-muted">No lines left on this bill.</p>}

        <div className="flex flex-wrap items-end gap-2 p-2.5 bg-cream/40 border-t border-sand/50">
          <label className="text-[11px] text-muted flex-1 min-w-[160px]">Add item · SKU with colour
            <input value={addSku} onChange={(e) => setAddSku(e.target.value)} placeholder="KPKN5352-Maroon"
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-full block mt-0.5 font-mono outline-none focus:border-emerald" />
          </label>
          <label className="text-[11px] text-muted">Qty
            <input type="number" min={1} value={addQty} onChange={(e) => setAddQty(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-16 text-center block mt-0.5 outline-none focus:border-emerald" />
          </label>
          <label className="text-[11px] text-muted">Rate ₹ <span className="text-muted">(blank = normal)</span>
            <input type="number" min={0} step="0.01" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} placeholder="auto"
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald" />
          </label>
          <button type="button" onClick={addLine} disabled={busy}
            className="px-3 py-1.5 rounded-full bg-ink text-cream text-xs disabled:opacity-50">+ Add to bill</button>
        </div>
      </div>

      <div className="rounded-xl border border-sand/70 bg-cream/30 p-3 mb-3">
        <p className="text-xs font-medium text-ink mb-2">Packing & courier</p>
        <p className="text-[11px] text-muted mb-2">Same fields as POS / Estimate. Online COD shipping is stored under Courier.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted">Packing ₹
            <input type="number" min={0} step="0.01" value={packing} onChange={(e) => setPacking(e.target.value)} placeholder="0"
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald bg-white" />
          </label>
          <label className="text-[11px] text-muted">Courier ₹
            <input type="number" min={0} step="0.01" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="0"
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald bg-white" />
          </label>
          <label className="text-[11px] text-muted">Adjustment ₹ <span className="text-muted">(±)</span>
            <input type="number" step="0.01" value={adjustment} onChange={(e) => setAdjustment(e.target.value)} placeholder="0"
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald bg-white" />
          </label>
          <button type="button" onClick={saveCharges} disabled={busy}
            className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs disabled:opacity-50">Save charges</button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-1">
        <p className="text-sm text-ink">Bill total: <b>{rupees(bill?.total ?? 0)}</b>
          {(bill?.amount_paid ?? 0) > 0 && <span className="text-muted text-xs ml-2">paid {rupees(bill!.amount_paid)}</span>}
        </p>
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
      <p className="text-[11px] text-muted mt-2">Line changes affect stock. Packing/courier only change the bill total. Settle any paid difference with the customer.</p>
    </div>
  );
}
