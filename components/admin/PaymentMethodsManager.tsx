"use client";
/**
 * PaymentMethodsManager — the master Payment Method registry UI (single source of truth).
 * Add / edit / disable / archive / delete / reorder / set-default, with live per-method balances,
 * search and filtering. All mutations go through server actions in app/actions/paymentMethods.ts.
 */
import { useMemo, useState } from "react";
import { formatPaise } from "@/lib/pricing";
import {
  addPaymentMethodAction, updatePaymentMethodAction, setPaymentMethodActiveAction,
  archivePaymentMethodAction, deletePaymentMethodAction, reorderPaymentMethodAction,
  setDefaultPaymentMethodAction,
} from "@/app/actions/paymentMethods";

type M = {
  id: string; name: string; kind: string; active: boolean; archived: boolean; is_default: boolean;
  bank_name: string | null; account_name: string | null; account_number: string | null;
  upi_id: string | null; branch: string | null; qr_code_url: string | null; notes: string | null;
  color: string | null; opening_balance: number;
  current_balance: number; total_in: number; total_out: number; today_in: number; today_out: number;
};

const TYPES = ["cash", "bank", "upi", "wallet", "card", "cheque", "razorpay", "other"];
const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
const TYPE_TONE: Record<string, string> = {
  cash: "bg-emerald-mist text-emerald-dark", bank: "bg-blue-50 text-blue-700", upi: "bg-violet-50 text-violet-700",
  wallet: "bg-amber-50 text-amber-700", card: "bg-indigo-50 text-indigo-700", cheque: "bg-slate-100 text-slate-600",
  razorpay: "bg-sky-50 text-sky-700", other: "bg-cream text-muted",
};

function FieldGrid({ m }: { m?: M }) {
  return (
    <>
      <label className="text-[11px] text-muted">Name<input name="name" defaultValue={m?.name ?? ""} required placeholder="e.g. Yogendra Industries SBI" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">Type
        <select name="kind" defaultValue={m?.kind ?? "bank"} className={`${inp} w-full mt-0.5`}>
          {TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
      </label>
      <label className="text-[11px] text-muted">Bank name<input name="bank_name" defaultValue={m?.bank_name ?? ""} placeholder="SBI / HDFC…" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">Account name<input name="account_name" defaultValue={m?.account_name ?? ""} placeholder="Yogendra Industries" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">Account number<input name="account_number" defaultValue={m?.account_number ?? ""} placeholder="optional" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">UPI ID<input name="upi_id" defaultValue={m?.upi_id ?? ""} placeholder="name@bank" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">Branch<input name="branch" defaultValue={m?.branch ?? ""} placeholder="optional" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">QR image URL<input name="qr_code_url" defaultValue={m?.qr_code_url ?? ""} placeholder="optional" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">Opening balance ₹<input name="opening_balance" type="number" step="0.01" defaultValue={m ? (m.opening_balance / 100).toFixed(2) : ""} placeholder="0" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted">Colour<input name="color" defaultValue={m?.color ?? ""} placeholder="#0F5C4D" className={`${inp} w-full mt-0.5`} /></label>
      <label className="text-[11px] text-muted sm:col-span-2">Notes<input name="notes" defaultValue={m?.notes ?? ""} placeholder="optional" className={`${inp} w-full mt-0.5`} /></label>
    </>
  );
}

export function PaymentMethodsManager({ methods }: { methods: M[] }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("all");
  const [statusF, setStatusF] = useState("all");

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return methods.filter((m) => {
      if (typeF !== "all" && m.kind !== typeF) return false;
      if (statusF === "active" && (!m.active || m.archived)) return false;
      if (statusF === "disabled" && m.active) return false;
      if (statusF === "archived" && !m.archived) return false;
      if (!s) return true;
      return [m.name, m.kind, m.bank_name, m.upi_id, m.account_name].some((v) => (v ?? "").toLowerCase().includes(s));
    });
  }, [methods, q, typeF, statusF]);

  return (
    <div className="bg-white rounded-2xl border border-sand p-5 shadow-card mb-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <p className="text-sm font-medium text-ink">Payment methods <span className="text-muted font-normal">· {methods.length}</span></p>
          <p className="text-xs text-muted">The single source of truth. Anything active here appears in POS, invoices &amp; collections instantly.</p>
        </div>
        <button onClick={() => { setAdding((a) => !a); setEditId(null); }} className="px-4 py-2 rounded-xl bg-ink text-white text-sm">{adding ? "Close" : "+ Add payment method"}</button>
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, bank, UPI…" className={`${inp} flex-1 min-w-[200px]`} />
        <select value={typeF} onChange={(e) => setTypeF(e.target.value)} className={inp}>
          <option value="all">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={inp}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Add form */}
      {adding && (
        <form action={addPaymentMethodAction} className="grid sm:grid-cols-2 gap-3 bg-cream/50 rounded-xl p-4 mb-4">
          <FieldGrid />
          <div className="sm:col-span-2 flex justify-end"><button className="px-4 py-2 rounded-xl bg-emerald text-white text-sm">Save method</button></div>
        </form>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted py-6 text-center">No payment methods match.</p>
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <div key={m.id} className={`rounded-xl border p-3 ${m.archived ? "border-sand bg-cream/40 opacity-70" : "border-sand bg-white"}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: m.color || "#C8A24C" }} />
                <div className="min-w-[160px]">
                  <p className="text-sm font-medium text-ink flex items-center gap-1.5">
                    {m.name}
                    {m.is_default && <span className="text-[9px] uppercase tracking-wide text-gold-dark bg-gold/15 px-1.5 py-0.5 rounded-full">Default</span>}
                  </p>
                  <p className="text-[11px] text-muted">{m.bank_name || m.upi_id || m.account_name || "—"}</p>
                </div>
                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${TYPE_TONE[m.kind] ?? TYPE_TONE.other}`}>{m.kind}</span>
                <div className="ml-auto text-right">
                  <p className="text-sm font-semibold text-ink">{formatPaise(m.current_balance)}</p>
                  <p className="text-[10px] text-muted">today +{formatPaise(m.today_in)}{m.today_out ? ` · −${formatPaise(m.today_out)}` : ""}</p>
                </div>
              </div>

              {/* Row actions */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[11px]">
                {!m.active && !m.archived && <span className="text-rose">Disabled</span>}
                <form action={reorderPaymentMethodAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="dir" value="up" /><button className="px-2 py-1 rounded-lg hover:bg-cream text-muted" title="Move up">↑</button></form>
                <form action={reorderPaymentMethodAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="dir" value="down" /><button className="px-2 py-1 rounded-lg hover:bg-cream text-muted" title="Move down">↓</button></form>
                <button onClick={() => { setEditId(editId === m.id ? null : m.id); setAdding(false); }} className="px-2 py-1 rounded-lg hover:bg-cream text-ink">Edit</button>
                {!m.is_default && (
                  <form action={setDefaultPaymentMethodAction}><input type="hidden" name="id" value={m.id} /><button className="px-2 py-1 rounded-lg hover:bg-cream text-gold-dark">Set default</button></form>
                )}
                <form action={setPaymentMethodActiveAction}>
                  <input type="hidden" name="id" value={m.id} /><input type="hidden" name="active" value={m.active ? "0" : "1"} />
                  <button className="px-2 py-1 rounded-lg hover:bg-cream text-muted">{m.active ? "Disable" : "Enable"}</button>
                </form>
                <form action={archivePaymentMethodAction}>
                  <input type="hidden" name="id" value={m.id} /><input type="hidden" name="archived" value={m.archived ? "0" : "1"} />
                  <button className="px-2 py-1 rounded-lg hover:bg-cream text-muted">{m.archived ? "Unarchive" : "Archive"}</button>
                </form>
                <form action={deletePaymentMethodAction}>
                  <input type="hidden" name="id" value={m.id} />
                  <button className="px-2 py-1 rounded-lg hover:bg-rose/10 text-rose" title="Delete (only if unused)">Delete</button>
                </form>
              </div>

              {/* Inline edit */}
              {editId === m.id && (
                <form action={updatePaymentMethodAction} className="grid sm:grid-cols-2 gap-3 bg-cream/50 rounded-xl p-4 mt-3">
                  <input type="hidden" name="id" value={m.id} />
                  <FieldGrid m={m} />
                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <button type="button" onClick={() => setEditId(null)} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm">Cancel</button>
                    <button className="px-4 py-2 rounded-xl bg-emerald text-white text-sm">Save changes</button>
                  </div>
                </form>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
