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
};

type OrderLite = {
  id: string; total?: number | null; amount_paid?: number | null; invoice_no?: string | null;
  bill_type?: string | null; gst_mode?: string | null; status?: string | null; created_at: string;
};

/** Grand total of a bill exactly as printed (GST added on top for exclusive GST bills). */
export const billGrand = (o: OrderLite) => orderReceivable({ ...o, amount_paid: 0 }, 0);

export async function getCustomerLedger(customerId: string, orders: OrderLite[], manualAdjustment = 0): Promise<{
  rows: LedgerRow[]; totalDebit: number; totalCredit: number; closing: number;
}> {
  const sb = supabaseServer();
  const live = orders.filter((o) => o.status !== "cancelled" && o.status !== "void");
  const ids = live.map((o) => o.id);

  const [pays, manual, rets] = await Promise.all([
    ids.length
      ? sb.from("payment_method_transactions").select("id,method_id,amount,occurred_at,note,ref_id,direction")
          .eq("ref_type", "order").eq("direction", "in").in("ref_id", ids)
      : Promise.resolve({ data: [] as any[] }),
    sb.from("payment_method_transactions").select("id,method_id,amount,occurred_at,note,direction,txn_type")
      .eq("ref_type", "customer").eq("ref_id", customerId),
    ids.length
      ? sb.from("returns").select("id,ref_order_id,amount,created_at,reason").eq("kind", "sales").in("ref_order_id", ids)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const payRows = ((pays as any).data as any[]) ?? [];
  const manualRows = ((manual as any).data as any[]) ?? [];
  const retRows = ((rets as any).data as any[]) ?? [];

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
    const unlogged = (o.amount_paid ?? 0) - (paidLogged.get(o.id) ?? 0);
    if (unlogged > 0) out.push({ key: `s-${o.id}`, date: o.created_at, type: "settled", label: `Paid on bill ${inv}`, href: `/admin/invoice/${o.id}`, debit: 0, credit: unlogged });
  }
  const invOf = new Map(live.map((o) => [o.id, o.invoice_no || String(o.id).slice(0, 8).toUpperCase()]));
  for (const p of payRows) {
    out.push({ key: `p-${p.id}`, date: p.occurred_at, type: "payment", label: `Payment · ${invOf.get(p.ref_id) ?? "bill"}`,
      href: `/admin/invoice/${p.ref_id}`, account: mName.get(p.method_id) ?? null, note: p.note ?? null, debit: 0, credit: p.amount ?? 0 });
  }
  for (const r of retRows) {
    if (!(r.amount > 0)) continue;
    out.push({ key: `r-${r.id}`, date: r.created_at, type: "return", label: `Return · ${invOf.get(r.ref_order_id) ?? "bill"}`,
      href: `/admin/invoice/${r.ref_order_id}`, note: r.reason ?? null, debit: 0, credit: r.amount });
  }
  for (const m of manualRows) {
    const isIn = m.direction === "in";
    out.push({ key: `m-${m.id}`, date: m.occurred_at, type: isIn ? "advance" : "debit",
      label: isIn ? "Payment received (on account)" : (m.method_id ? "Paid to customer" : "Debit entry"),
      account: m.method_id ? (mName.get(m.method_id) ?? null) : null, note: m.note ?? null,
      debit: isIn ? 0 : (m.amount ?? 0), credit: isIn ? (m.amount ?? 0) : 0 });
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
