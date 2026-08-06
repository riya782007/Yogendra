"use client";
/**
 * ReceivePaymentButton — "payment in" from a customer, right on their page / the creditors list.
 * Owner enters the amount + method; it auto-allocates OLDEST BILL FIRST across the customer's
 * outstanding (GST-inclusive, net of returns), feeds Bank & Cash, and refreshes the ledgers.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { receiveCustomerPaymentAction, listReceiveAccountsAction } from "@/app/actions/billing";

type Account = { id: string; name: string; kind: string; upiId: string | null; isDefault: boolean };

export function ReceivePaymentButton({ customerId, phone, customerName, outstandingPaise }: {
  customerId?: string | null; phone?: string | null; customerName?: string; outstandingPaise?: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // Load the owner's real accounts (Cash / UPI / banks) when the dialog opens, default to his default one.
  useEffect(() => {
    if (!open || accounts !== null) return;
    listReceiveAccountsAction().then((a) => {
      setAccounts(a);
      setAccountId(a.find((x) => x.isDefault)?.id ?? a[0]?.id ?? "");
    }).catch(() => setAccounts([]));
  }, [open, accounts]);

  async function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setMsg("Enter the amount received."); return; }
    const acct = (accounts ?? []).find((a) => a.id === accountId);
    if (!acct) { setMsg("Choose the account the money came into."); return; }
    setBusy(true); setMsg("");
    const method = acct.kind === "cash" ? "cash" : "bank";
    const r = await receiveCustomerPaymentAction({ customerId, phone, amountRupees: n, method, methodId: acct.id, note });
    setBusy(false);
    if (!r.ok) { setMsg(`✕ ${r.error}`); return; }
    const alloc = (r.allocated ?? []).map((a) => `${a.invoice} ${formatPaise(a.paise)}`).join(", ");
    setMsg(`✓ Allocated: ${alloc}${(r.leftoverPaise ?? 0) > 0 ? ` · ${formatPaise(r.leftoverPaise!)} extra (no open bills left)` : ""}`);
    router.refresh();
    setTimeout(() => { setOpen(false); setAmount(""); setNote(""); setMsg(""); }, 2500);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-3.5 py-2 rounded-full bg-emerald text-white text-sm font-medium hover:bg-emerald-dark whitespace-nowrap">
        ₹ Receive payment
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-luxe border border-sand p-5 max-w-sm w-full">
            <p className="font-medium text-ink">Receive payment{customerName ? ` — ${customerName}` : ""}</p>
            {outstandingPaise != null && <p className="text-xs text-muted mt-0.5">Outstanding {formatPaise(outstandingPaise)} — allocates to the oldest bill first.</p>}
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount received (₹)"
              className="w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm outline-none focus:border-emerald mt-3" autoFocus />
            <label className="block text-[11px] text-muted mt-3 mb-1">Received in which account?</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm outline-none focus:border-emerald bg-white">
              {accounts === null && <option value="">Loading accounts…</option>}
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.upiId ? ` · ${a.upiId}` : ""}{a.kind === "cash" ? " · Cash" : ""}</option>
              ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional — e.g. UTR, cheque no.)"
              className="w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm outline-none focus:border-emerald mt-2" />
            {msg && <p className="text-xs mt-2 text-ink">{msg}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">Close</button>
              <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-xl bg-emerald text-white text-sm hover:bg-emerald-dark disabled:opacity-50">{busy ? "Recording…" : "Record payment"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
