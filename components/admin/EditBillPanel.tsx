"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOrderForEditAction, editOrderLineAction, addOrderLineAction, editOrderChargesAction } from "@/app/actions/billing";

type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; status: string; customer_name: string | null;
  extra_packing: number; extra_courier: number; extra_adjustment: number;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

function rupees(paise: number) { return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`; }
function paiseToInput(p: number) { return (Number(p) / 100).toFixed(2).replace(/\.00$/, ""); }

/** OTP-gated bill editor. Lines AND packing/courier/adjustment. Stock, revenue and the total
 *  correct themselves; staff can't edit silently (no OTP, no change). */
export function EditBillPanel({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [bill, setBill] = useState<EditableBill | null>(null);
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // Adding the RIGHT colour after removing a wrong one — the other half of correcting a bill.
  const [addSku, setAddSku] = useState("");
  const [addQty, setAddQty] = useState("1");
  const [addPrice, setAddPrice] = useState("");
  const [packing, setPacking] = useState("0");
  const [courier, setCourier] = useState("0");
  const [adjustment, setAdjustment] = useState("0");

  function applyBill(b: EditableBill) {
    setBill(b);
    setQtyDraft(Object.fromEntries(b.items.map((it) => [it.id, String(it.qty)])));
    setPacking(paiseToInput(b.extra_packing ?? 0));
    setCourier(paiseToInput(b.extra_courier ?? 0));
    setAdjustment(paiseToInput(b.extra_adjustment ?? 0));
  }

  async function reload() {
    const fresh = await fetchOrderForEditAction(orderId);
    if (fresh.ok && fresh.bill) applyBill(fresh.bill);
    router.refresh();
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

  async function load() {
    setBusy(true); setMsg(null);
    const r = await fetchOrderForEditAction(orderId);
    setBusy(false);
    if (!r.ok || !r.bill) { setMsg({ text: r.error ?? "Couldn't load the bill.", ok: false }); return; }
    applyBill(r.bill);
    setOpen(true);
  }

  async function save(itemId: string, newQty: number) {
    if (!otp.trim()) { setMsg({ text: "Enter the owner OTP first.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await editOrderLineAction({ orderId, itemId, newQty, otp: otp.trim() });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Edit failed.", ok: false }); return; }
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
    setMsg({ text: "Charges updated ✓", ok: true });
    await reload();
  }

  if (!open) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="font-medium text-ink mb-1">✎ Edit this bill <span className="text-xs text-muted font-normal">· owner OTP required</span></h2>
        <p className="text-xs text-muted mb-3">Fix quantities, add/remove lines, or change packing / courier / adjustment (e.g. drop courier on a COD bill after taking it as confirmation). Stock &amp; totals correct themselves.</p>
        <button onClick={load} disabled={busy} className="px-4 py-2 rounded-full bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">{busy ? "Loading…" : "Edit bill →"}</button>
        {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-5 shadow-card sm:col-span-2">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium text-ink">✎ Editing bill {bill?.invoice_no ?? ""}</h2>
        <button onClick={() => { setOpen(false); setOtp(""); setMsg(null); }} className="text-muted hover:text-ink text-sm">Close ✕</button>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <label className="text-xs text-muted">Owner OTP</label>
        <input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="● ● ● ● ● ●"
          className="rounded-lg border border-sand px-3 py-1.5 text-sm w-32 tracking-widest outline-none focus:border-emerald" />
        <span className="text-[11px] text-muted">Ask the owner for today&apos;s code — needed for every change.</span>
      </div>

      <div className="divide-y divide-sand/60 border border-sand rounded-xl">
        {(bill?.items ?? []).map((it) => (
          <div key={it.id} className="flex flex-wrap items-center gap-2 p-2.5">
            <div className="flex-1 min-w-[160px]">
              <p className="text-sm text-ink">{it.name}</p>
              <p className="text-[11px] text-muted font-mono">{it.sku} · {rupees(it.unit_price)} each · line {rupees(it.line_total)}</p>
            </div>
            <input
              type="number" min={0}
              value={qtyDraft[it.id] ?? String(it.qty)}
              onChange={(e) => setQtyDraft((d) => ({ ...d, [it.id]: e.target.value }))}
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-16 text-center outline-none focus:border-emerald" />
            <button onClick={() => save(it.id, Math.max(0, Math.floor(Number(qtyDraft[it.id] ?? it.qty))))} disabled={busy}
              className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs disabled:opacity-50">Save</button>
            <button onClick={() => save(it.id, 0)} disabled={busy}
              className="px-3 py-1.5 rounded-full border border-rose/40 text-rose text-xs hover:bg-rose/5 disabled:opacity-50">Remove</button>
          </div>
        ))}
        {(bill?.items ?? []).length === 0 && <p className="p-3 text-sm text-muted">No lines left on this bill.</p>}

        {/* Add the correct item — e.g. the right colour after removing a wrongly-picked one. */}
        <div className="flex flex-wrap items-end gap-2 p-2.5 bg-cream/40">
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
          <button onClick={addLine} disabled={busy}
            className="px-3 py-1.5 rounded-full bg-ink text-cream text-xs disabled:opacity-50">+ Add to bill</button>
        </div>
      </div>

      <div className="mt-3 border border-sand rounded-xl p-3 bg-cream/30">
        <p className="text-xs font-medium text-ink mb-1">Packing / courier / adjustment</p>
        <p className="text-[11px] text-muted mb-2">COD confirmation often takes courier in advance while the invoice still shows goods + courier. Set courier to 0 (or the true amount) so the remaining due is only what is still to be collected. If that advance should sit against this bill, record it as a payment on the invoice first.</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[11px] text-muted">Packing ₹
            <input type="number" min={0} step="0.01" value={packing} onChange={(e) => setPacking(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald" />
          </label>
          <label className="text-[11px] text-muted">Courier ₹
            <input type="number" min={0} step="0.01" value={courier} onChange={(e) => setCourier(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald" />
          </label>
          <label className="text-[11px] text-muted">Adjustment ₹
            <input type="number" step="0.01" value={adjustment} onChange={(e) => setAdjustment(e.target.value)}
              className="rounded-lg border border-sand px-2 py-1.5 text-sm w-24 text-right block mt-0.5 outline-none focus:border-emerald" />
          </label>
          <button onClick={saveCharges} disabled={busy}
            className="px-3 py-1.5 rounded-full bg-gold text-ink text-xs font-medium disabled:opacity-50">Save charges</button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3">
        <p className="text-sm text-ink">Bill total: <b>{rupees(bill?.total ?? 0)}</b>
          {bill ? <span className="text-muted font-normal text-xs"> · paid {rupees(bill.amount_paid ?? 0)}</span> : null}
        </p>
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
      <p className="text-[11px] text-muted mt-2">This changes the recorded sale. If money was already collected, settle any difference with the customer — the invoice will show the new balance due.</p>
    </div>
  );
}
