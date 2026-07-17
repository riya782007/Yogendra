"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchOrderForEditAction, editOrderLineAction } from "@/app/actions/billing";

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
        <p className="text-xs text-muted mb-3">Fix a wrong quantity or remove a mis-scanned line. Stock &amp; totals correct themselves — no need to cancel the whole bill.</p>
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
      </div>

      <div className="flex items-center justify-between mt-3">
        <p className="text-sm text-ink">Bill items total: <b>{rupees(bill?.total ?? 0)}</b></p>
        {msg && <p className={`text-xs ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
      </div>
      <p className="text-[11px] text-muted mt-2">Note: this changes stock and the recorded sale. If money was already collected, settle any difference with the customer in cash — the bill will show the new balance.</p>
    </div>
  );
}
