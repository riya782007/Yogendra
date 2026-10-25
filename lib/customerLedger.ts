/**
 * Customer ledger (khata) — every rupee a customer owes or paid, in date order, with a running balance.
 *
 * Owner (Oct 2026): "Customer ka ledger thoda ache se bna do. Payment ka record nhi h usme."
 * The customer page only listed bills, so the owner couldn't see WHEN or HOW a customer paid.
 *
 * Nothing new is stored to build this — it reads what the system already records:
 *   DEBIT  (customer owes more)  · each bill, at its grand total (same rounding as the printed bill)
 *                                · a manual "Debit" entry from Receive payment (money given / old dues)
 *                                · the manual adjustment on the customer profile, when positive
 *   CREDIT (customer owes less)  · every payment logged against a bill (payment_method_transactions,
 *                                  with the account it went into and the date it was received)
 *                                · any part of a bill marked paid with no account logged (older bills,
 *                                  write-offs) — shown on the bill date as "Settled"
 *                                · sales returns (credit notes)
 *                                · advances: money received when no bill was open
 *
 * Because bills and their payments come from the same `amount_paid` the Outstanding tile uses, the
 * ledger's bill-related balance always agrees with it; advances and manual debits are the only extra
 * lines, and they are labelled as such.
 */
import { supabaseServer } from "@/lib/supabase/server";
import { orderReceivable } from "@/lib/supabase/queries";

export type LedgerRow = {
  key: string;
  date: string;              // ISO
  type: "bill" | "payment" | "settled" | "return" | "advance" | "debit" | "adjustment";
  label: string;
  href?: string;
  account?: string | null;
  note?: string | null;
  debit: number;             // paise
  credit: number;            // paise
  balance: number;           // paise, running (positive = customer owes)
  /** payment_method_transactions ids behind this line — lets the owner delete a wrong entry. */
  txnIds?: string[];
};

type OrderLite = {
  id: string; total?: number | null; amount_paid?: number | null; invoice_no?: string | null;
  bill_type?: string | null; gst_mode?: string | null; status?: string | null; created_at: string;
  channel?: string | null; admin_note?: string | null; grand?: number | null;
};

/** Short-payment write-offs recorded on the bill (writeOffBillBalanceAction notes them on admin_note). */
function writtenOffPaise(note?: string | null): number {
  return [...String(note ?? "").matchAll(/Balance ₹([\d,]+(?:\.\d+)?) written off/g)]
    .reduce((s, m) => s + Math.round(Number(m[1].replace(/,/g, "")) * 100), 0);
}

/** Grand total of a bill exactly as printed (GST added on top for exclusive GST bills). */
export const billGrand = (o: OrderLite) => orderReceivable({ ...o, amount_paid: 0 }, 0);

export async function getCustomerLedger(customerId: string, orders: OrderLite[], manualAdjustment = 0): Promise<{
  rows: LedgerRow[]; totalDebit: number; totalCredit: number; closing: number;
}> {
  const sb = supabaseServer();
  const live = orders.filter((o) => o.status !== "cancelled" && o.status !== "void");
  const ids = live.map((o) => o.id);

  // Bill-linked reads go in chunks: a long customer history as one in() list makes the request URL
  // too long and the read fails, which would silently drop every payment from the ledger.
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  const [paysParts, manual, retsParts] = await Promise.all([
    Promise.all(chunks.map((c) => sb.from("payment_method_transactions").select("id,method_id,amount,occurred_at,note,ref_id,direction,txn_type,created_at")
      .eq("ref_type", "order").eq("direction", "in").in("ref_id", c))),
    sb.from("payment_method_transactions").select("id,method_id,amount,occurred_at,note,direction,txn_type,created_at")
      .eq("ref_type", "customer").eq("ref_id", customerId),
    Promise.all(chunks.map((c) => sb.from("returns").select("id,ref_order_id,amount,created_at,reason").eq("kind", "sales").in("ref_order_id", c))),
  ]);
  const payRows = paysParts.flatMap((r: any) => (r.data as any[]) ?? []);
  const manualRows = ((manual as any).data as any[]) ?? [];
  const retRows = retsParts.flatMap((r: any) => (r.data as any[]) ?? []);

  const methodIds = [...new Set([...payRows, ...manualRows].map((p) => p.method_id).filter(Boolean))];
  const { data: methods } = methodIds.length
    ? await sb.from("payment_methods").select("id,name").in("id", methodIds)
    : { data: [] as any[] };
  const mName = new Map<string, string>(((methods as any[]) ?? []).map((m) => [m.id, m.name]));

  const out: Omit<LedgerRow, "balance">[] = [];
  const paidLogged = new Map<string, number>();
  for (const p of payRows) paidLogged.set(p.ref_id, (paidLogged.get(p.ref_id) ?? 0) + (p.amount ?? 0));

  for (const o of live) {
    const inv = o.invoice_no || String(o.id).slice(0, 8).toUpperCase();
    out.push({ key: `b-${o.id}`, date: o.created_at, type: "bill", label: `Bill ${inv}`, href: `/admin/invoice/${o.id}`, debit: billGrand(o), credit: 0 });
    // Part of the bill marked paid with no account entry (old bills / write-offs) — on the bill date.
    // A written-off shortfall is a discount, not money received — show it on its own line so the
    // ledger reads "₹17,700 paid · ₹9 written off" instead of one "paid" figure that never arrived.
    const unlogged = (o.amount_paid ?? 0) - (paidLogged.get(o.id) ?? 0);
    const wo = Math.min(Math.max(0, unlogged), writtenOffPaise(o.admin_note));
    if (unlogged - wo > 0) out.push({ key: `s-${o.id}`, date: o.created_at, type: "settled", label: `Paid on bill ${inv}`, href: `/admin/invoice/${o.id}`, debit: 0, credit: unlogged - wo });
    if (wo > 0) out.push({ key: `w-${o.id}`, date: o.created_at, type: "settled", label: `Written off · ${inv}`, href: `/admin/invoice/${o.id}`, note: "discount — not received", debit: 0, credit: wo });
  }
  const invOf = new Map(live.map((o) => [o.id, o.invoice_no || String(o.id).slice(0, 8).toUpperCase()]));
  /**
   * ONE line per receipt, not one per bill it settled. Owner, Oct 2026: "maine customer se ₹2 lakh
   * receive kiye to wo bill-wise entry karta hai — ek entry honi chahiye, is date ko itna amount mila."
   * "Receive payment" spreads one amount over the oldest open bills and writes a row per bill (plus an
   * advance row for any leftover), all with the same date and account, saved within a second or two.
   * Those rows are grouped back into the single receipt they came from; the bills it settled are
   * listed underneath. A payment taken at the counter on a single bill still shows as before.
   */
  const receiptRows = [
    ...payRows.map((p) => ({ ...p, kind: "bill" as const })),
    ...manualRows.filter((m) => m.direction === "in").map((m) => ({ ...m, kind: "advance" as const })),
  ].sort((a, b) =>
    String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.method_id ?? "").localeCompare(String(b.method_id ?? "")) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  // A receipt settles bills oldest-first, so inside one receipt each next bill is newer than the last
  // and no bill appears twice. A second receipt (e.g. the same amount recorded twice by mistake) starts
  // again from the oldest open bill — that step backwards marks where one receipt ends and the next begins.
  const billDate = new Map(live.map((o) => [o.id, o.created_at]));
  const groups: (typeof receiptRows)[] = [];
  for (const r of receiptRows) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    const lastBill = g ? [...g].reverse().find((x) => x.kind === "bill") : undefined;
    const sameReceipt = !!prev && prev.occurred_at === r.occurred_at && (prev.method_id ?? "") === (r.method_id ?? "")
      && (prev.note ?? "") === (r.note ?? "")
      && Math.abs(new Date(r.created_at ?? r.occurred_at).getTime() - new Date(prev.created_at ?? prev.occurred_at).getTime()) <= 4000
      && prev.kind === "bill"
      && !(r.kind === "bill" && g.some((x) => x.kind === "bill" && x.ref_id === r.ref_id))
      && !(r.kind === "bill" && lastBill && String(billDate.get(r.ref_id) ?? "") < String(billDate.get(lastBill.ref_id) ?? ""));
    if (sameReceipt) g.push(r); else groups.push([r]);
  }
  for (const g of groups) {
    const total = g.reduce((s, r) => s + (r.amount ?? 0), 0);
    const bills = g.filter((r) => r.kind === "bill");
    const adv = g.filter((r) => r.kind === "advance").reduce((s, r) => s + (r.amount ?? 0), 0);
    const single = g.length === 1 && bills.length === 1;
    const billList = bills.map((r) => invOf.get(r.ref_id) ?? "bill");
    const detail = [
      !single && bills.length ? `Against ${billList.length} bill${billList.length === 1 ? "" : "s"}: ${billList.join(", ")}` : null,
      adv > 0 && bills.length ? `₹${Math.round(adv / 100).toLocaleString("en-IN")} kept as advance` : null,
      g[0].note ?? null,
    ].filter(Boolean).join(" · ");
    out.push({
      key: `p-${g[0].id}`, date: g[0].occurred_at, type: bills.length ? "payment" : "advance",
      label: single ? `Payment · ${billList[0]}` : bills.length ? "Payment received" : "Payment received (on account)",
      href: single ? `/admin/invoice/${bills[0].ref_id}` : undefined,
      account: mName.get(g[0].method_id) ?? null, note: detail || null, debit: 0, credit: total,
      txnIds: g.map((r) => r.id),
    });
  }
  for (const r of retRows) {
    if (!(r.amount > 0)) continue;
    out.push({ key: `r-${r.id}`, date: r.created_at, type: "return", label: `Return · ${invOf.get(r.ref_order_id) ?? "bill"}`,
      href: `/admin/invoice/${r.ref_order_id}`, note: r.reason ?? null, debit: 0, credit: r.amount });
  }
  for (const m of manualRows) {
    if (m.direction === "in") continue; // money received on account is part of a receipt line above
    out.push({ key: `m-${m.id}`, date: m.occurred_at, type: "debit",
      label: m.method_id ? "Paid to customer" : "Debit entry",
      account: m.method_id ? (mName.get(m.method_id) ?? null) : null, note: m.note ?? null,
      debit: m.amount ?? 0, credit: 0, txnIds: [m.id] });
  }
  if (manualAdjustment) {
    const first = out.reduce((d, r) => (r.date < d ? r.date : d), new Date().toISOString());
    out.push({ key: "adj", date: first, type: "adjustment", label: "Manual adjustment (customer profile)",
      debit: manualAdjustment > 0 ? manualAdjustment : 0, credit: manualAdjustment < 0 ? -manualAdjustment : 0 });
  }

  // Date order; on the same instant a bill comes before what pays it.
  const rank: Record<LedgerRow["type"], number> = { adjustment: 0, bill: 1, debit: 2, settled: 3, payment: 4, return: 5, advance: 6 };
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : rank[a.type] - rank[b.type]));
  let bal = 0, totalDebit = 0, totalCredit = 0;
  const rows: LedgerRow[] = out.map((r) => {
    bal += r.debit - r.credit; totalDebit += r.debit; totalCredit += r.credit;
    return { ...r, balance: bal };
  });
  return { rows, totalDebit, totalCredit, closing: bal };
}
