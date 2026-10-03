"use client";
/**
 * ReceivePaymentButton — record money in (or out) for a customer, right on their page / the creditors list.
 *
 * CREDIT (default) = payment received: auto-allocates OLDEST BILL FIRST across the customer's
 * outstanding (GST-inclusive, net of returns), feeds Bank & Cash; anything left over is kept as an
 * advance on the customer's ledger.
 * DEBIT = the customer owes more: money paid out to them from an account, or an old balance / charge
 * with no money moving. Only offered where the customer has a profile (their ledger lives there).
 *
 * Owner (Oct 2026): "recieve payment me date dedo and debit credit types bna do" — every entry takes
 * a date, so a payment received last week (or last year) is booked on the day it really came in.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { receiveCustomerPaymentAction, listReceiveAccountsAction } from "@/app/actions/billing";

type Account = { id: string; name: string; kind: string; upiId: string | null; isDefault: boolean };

const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const NO_MONEY = "__none__";

export function ReceivePaymentButton({ customerId, phone, customerName, outstandingPaise, label }: {
  customerId?: string | null; phone?: string | null; customerName?: string; outstandingPaise?: number; label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"credit" | "debit">("credit");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayIst());
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [askAdvance, setAskAdvance] = useState(false);
  const canDebit = !!customerId;

  // Load the owner's real accounts (Cash / UPI / banks) when the dialog opens, default to his default one.
  useEffect(() => {
    if (!open || accounts !== null) return;
    listReceiveAccountsAction().then((a) => {
      setAccounts(a);
      setAccountId(a.find((x) => x.isDefault)?.id ?? a[0]?.id ?? "");
    }).catch(() => setAccounts([]));
  }, [open, accounts]);

  function reset() { setAmount(""); setNote(""); setMsg(""); setAskAdvance(false); setKind("credit"); setDate(todayIst()); }

  async function submit(asAdvance = false) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setMsg("Enter the amount."); return; }
    const noMoney = kind === "debit" && accountId === NO_MONEY;
    const acct = (accounts ?? []).find((a) => a.id === accountId);
    if (!noMoney && !acct) { setMsg(kind === "credit" ? "Choose the account the money came into." : "Choose the account the money was paid from."); return; }
    if (noMoney && !note.trim()) { setMsg("Add a note — what is this debit for? (e.g. old balance)"); return; }
    setBusy(true); setMsg("");
    const method = acct?.kind === "cash" ? "cash" : "bank";
    const r = await receiveCustomerPaymentAction({
      customerId, phone, amountRupees: n, method, methodId: noMoney ? null : acct!.id, note,
      kind, date, asAdvance,
    });
    setBusy(false);
    if (!r.ok) {
      if (r.noOpenBills && canDebit) { setAskAdvance(true); setMsg(r.error ?? ""); return; }
      setMsg(`✕ ${r.error}`); return;
    }
    if (kind === "debit") setMsg(`✓ Debit of ${formatPaise(Math.round(n * 100))} added to the ledger.`);
    else {
      const alloc = (r.allocated ?? []).map((a) => `${a.invoice} ${formatPaise(a.paise)}`).join(", ");
      const adv = (r.advancePaise ?? 0) > 0 ? ` · ${formatPaise(r.advancePaise!)} kept as advance` : "";
      const extra = (r.leftoverPaise ?? 0) > 0 ? ` · ${formatPaise(r.leftoverPaise!)} extra (no open bills left)` : "";
      setMsg(`✓ ${alloc ? `Allocated: ${alloc}` : "Recorded"}${adv}${extra}`);
    }
    setAskAdvance(false);
    router.refresh();
    setTimeout(() => { setOpen(false); reset(); }, 2500);
  }

  const fld = "w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm outline-none focus:border-emerald bg-white";

  return (
    <>
      <button onClick={() => setOpen(true)} className="px-3.5 py-2 rounded-full bg-emerald text-white text-sm font-medium hover:bg-emerald-dark whitespace-nowrap">
        {label ?? "₹ Receive payment"}
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <div className="absolute inset-0 bg-ink/40" onClick={() => !busy && setOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-luxe border border-sand p-5 max-w-sm w-full">
            <p className="font-medium text-ink">{kind === "credit" ? "Receive payment" : "Debit entry"}{customerName ? ` — ${customerName}` : ""}</p>

            {canDebit && (
              <div className="grid grid-cols-2 gap-1 bg-cream rounded-xl p-1 mt-3">
                <button type="button" onClick={() => { setKind("credit"); setAskAdvance(false); setMsg(""); if (accountId === NO_MONEY) setAccountId((accounts ?? []).find((x) => x.isDefault)?.id ?? (accounts ?? [])[0]?.id ?? ""); }}
                  className={`rounded-lg py-1.5 text-xs font-medium ${kind === "credit" ? "bg-emerald text-white" : "text-muted"}`}>
                  Credit · Received (जमा)
                </button>
                <button type="button" onClick={() => { setKind("debit"); setAskAdvance(false); setMsg(""); }}
                  className={`rounded-lg py-1.5 text-xs font-medium ${kind === "debit" ? "bg-rose text-white" : "text-muted"}`}>
                  Debit · Given / owed (नामे)
                </button>
              </div>
            )}
            <p className="text-xs text-muted mt-2">
              {kind === "credit"
                ? <>Money received from the customer. {outstandingPaise != null && outstandingPaise > 0 ? <>Outstanding {formatPaise(outstandingPaise)} — settles the oldest bill first.</> : <>Settles the oldest open bill first.</>}</>
                : <>Customer owes more: money you paid them, or an old balance / charge. Bills are not changed.</>}
            </p>

            <div className="grid grid-cols-2 gap-2 mt-3">
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Amount (₹)" className={fld} autoFocus />
              <input type="date" value={date} max={todayIst()} onChange={(e) => setDate(e.target.value)} className={fld} title="Date of this entry — pick a past date to post an old payment" />
            </div>

            <label className="block text-[11px] text-muted mt-3 mb-1">{kind === "credit" ? "Received in which account?" : "Paid from which account?"}</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={fld}>
              {accounts === null && <option value="">Loading accounts…</option>}
              {kind === "debit" && <option value={NO_MONEY}>No money moved — old balance / charge</option>}
              {(accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>{a.name}{a.upiId ? ` · ${a.upiId}` : ""}{a.kind === "cash" ? " · Cash" : ""}</option>
              ))}
            </select>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "credit" ? "Note (optional — e.g. UTR, cheque no.)" : "Note — what is this for?"}
              className={`${fld} mt-2`} />
            {msg && <p className="text-xs mt-2 text-ink">{msg}</p>}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => { setOpen(false); reset(); }} disabled={busy} className="px-4 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10 disabled:opacity-50">Close</button>
              {askAdvance ? (
                <button onClick={() => submit(true)} disabled={busy} className="px-4 py-2 rounded-xl bg-gold text-ink text-sm hover:opacity-90 disabled:opacity-50">{busy ? "Saving…" : "Save as advance"}</button>
              ) : (
                <button onClick={() => submit(false)} disabled={busy} className={`px-4 py-2 rounded-xl text-white text-sm disabled:opacity-50 ${kind === "credit" ? "bg-emerald hover:bg-emerald-dark" : "bg-rose hover:opacity-90"}`}>
                  {busy ? "Saving…" : kind === "credit" ? "Record payment" : "Add debit"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
