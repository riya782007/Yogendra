"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOrderForEditAction, editOrderLineAction, addOrderLineAction } from "@/app/actions/billing";

type EditableBill = {
  id: string; invoice_no: string | null; total: number; amount_paid: number;
  is_backorder: boolean; status: string; customer_name: string | null;
  items: { id: string; sku: string; name: string; qty: number; unit_price: number; line_total: number }[];
};

function rupees(paise: number) { return `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`; }

/** OTP-gated bill editor. The owner opens it, enters the OTP once, then can fix a wrong quantity or
 *  remove a mis-scanned line WITHOUT cancelling the whole bill — stock, revenue and the total are
 *  corrected server-side (edit_order_line RPC). Staff can't edit silently: no OTP, no change. */
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

  async function reload() {
    const fresh = await fetchOrderForEditAction(orderId);
    if (fresh.ok && fresh.bill) {
      setBill(fresh.bill);
      setQtyDraft(Object.fromEntries(fresh.bill.items.map((it) => [it.id, String(it.qty)])));
    }
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
    setBill(r.bill);
    setQtyDraft(Object.fromEntries(r.bill.items.map((it) => [it.id, String(it.qty)])));
    setOpen(true);
  }

  async function save(itemId: string, newQty: number) {
    if (!otp.trim()) { setMsg({ text: "Enter the owner OTP first.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await editOrderLineAction({ orderId, itemId, newQty, otp: otp.trim() });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Edit failed.", ok: false }); return; }
    setMsg({ text: r.removed ? "Line removed ✓" : "Quantity updated ✓", ok: true });
    const fresh = await fetchOrderForEditAction(orderId);
    if (fresh.ok && fresh.bill) {
      setBill(fresh.bill);
      setQtyDraft(Object.fromEntries(fresh.bill.items.map((it) => [it.id, String(it.qty)])));
    }
    router.refresh(); // repaint the printed invoice with corrected totals
  }

  if (!open) {
    return (
      <div className="bg-white rounded-2xl p-5 shadow-card">
        <h2 className="font-medium text-ink mb-1">✎ Edit this bill <span className="text-xs text-muted font-normal">· owner OTP required</span></h2>
        <p className="text-xs text-muted mb-3">Fix a wrong quantity, remove a mis-scanned line, or add the right one — e.g. swap a wrongly-picked colour. Stock &amp; totals correct themselves; no need to cancel the whole bill.</p>
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

      <div className="flex items-center justify-between mt-3">
        <p className="text-sm text-ink">Bill items total: <b>{rupees(bill?.total ?? 0)}</b></p>
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
      <p className="text-[11px] text-muted mt-2">Note: this changes stock and the recorded sale. If money was already collected, settle any difference with the customer in cash — the bill will show the new balance.</p>
    </div>
  );
}
