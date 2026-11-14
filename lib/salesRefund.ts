/**
 * REFUND ON A SALES RETURN — which account the money went back out of.
 *
 * Yogendra (Nov 2026), on the Sales page's ↩ Return button: "Yaha payment mode dedo return hta do.
 * Cash, UPI, Kotak, HDFC — jisme gyi h wo krdo."
 * A return used to restock the pieces and write a credit note, but the money handed back to the
 * customer never left any account, so Cash / UPI / bank balances stayed too high. Now the return
 * dialog asks which account the refund was paid from, and that account gets a money-OUT entry.
 *
 * How much is refunded: only money the customer actually paid that is now more than what the bill is
 * worth after its returns. A fully-paid bill refunds the full return value; an unpaid (credit) bill
 * refunds nothing — the return just lowers what they owe. Never more than this return's value, and a
 * refund already given on an earlier return of the same bill is not repeated.
 */
import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { attachInvoiceGrand } from "@/lib/supabase/queries";
import { billGrandPaise } from "@/lib/orderBill";

export async function refundSalesReturn(opts: {
  orderId: string; returnId?: string | null; methodId?: string | null; by?: string;
}): Promise<{ amount: number; account: string | null }> {
  const { orderId, methodId } = opts;
  if (!orderId || !methodId) return { amount: 0, account: null };
  const sb = supabaseServer();

  const [{ data: o }, { data: rets }, { data: m }] = await Promise.all([
    sb.from("orders").select("id,invoice_no,total,amount_paid,bill_type,gst_mode,channel,status").eq("id", orderId).maybeSingle(),
    sb.from("returns").select("id,amount,created_at").eq("kind", "sales").eq("ref_order_id", orderId).order("created_at", { ascending: false }),
    sb.from("payment_methods").select("id,name").eq("id", methodId).maybeSingle(),
  ]);
  if (!o || !m) return { amount: 0, account: null };
  const returns = ((rets as any[]) ?? []);
  // The return just recorded: the id the RPC gave back, else the newest return on this bill.
  const thisRet = (opts.returnId && returns.find((r) => r.id === opts.returnId)) || returns[0];
  if (!thisRet || !(thisRet.amount > 0)) return { amount: 0, account: (m as any).name };

  const retIds = returns.map((r) => r.id);
  const { data: prior } = await sb.from("payment_method_transactions").select("amount,ref_id")
    .eq("ref_type", "sales_return").eq("direction", "out").in("ref_id", retIds);
  if (((prior as any[]) ?? []).some((p) => p.ref_id === thisRet.id)) return { amount: 0, account: (m as any).name }; // already refunded
  const refundedBefore = ((prior as any[]) ?? []).reduce((s, p) => s + (p.amount ?? 0), 0);

  const [withGrand] = await attachInvoiceGrand([o as any]);
  const grand = billGrandPaise(withGrand as any);
  const returnsTotal = returns.reduce((s, r) => s + (r.amount ?? 0), 0);
  const overpaid = ((o as any).amount_paid ?? 0) - Math.max(0, grand - returnsTotal) - refundedBefore;
  const amount = Math.max(0, Math.min(thisRet.amount, overpaid));
  if (amount <= 0) return { amount: 0, account: (m as any).name };

  const inv = (o as any).invoice_no || String(orderId).slice(0, 8).toUpperCase();
  await sb.from("payment_method_transactions").insert({
    method_id: methodId, txn_type: "refund", direction: "out", amount,
    ref_type: "sales_return", ref_id: thisRet.id, note: `Refund on return · ${inv}`,
    created_by: opts.by ?? "owner", occurred_at: new Date().toISOString(),
  });
  return { amount, account: (m as any).name };
}

/** The account a bill was mostly paid into — the sensible default for where its refund comes from. */
export async function billPaidAccount(orderId: string): Promise<{ paid: number; methodId: string | null }> {
  const sb = supabaseServer();
  const [{ data: o }, { data: tx }] = await Promise.all([
    sb.from("orders").select("amount_paid").eq("id", orderId).maybeSingle(),
    sb.from("payment_method_transactions").select("method_id,amount").eq("ref_type", "order").eq("ref_id", orderId).eq("direction", "in"),
  ]);
  const by = new Map<string, number>();
  for (const t of ((tx as any[]) ?? [])) if (t.method_id) by.set(t.method_id, (by.get(t.method_id) ?? 0) + (t.amount ?? 0));
  const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
  return { paid: (o as any)?.amount_paid ?? 0, methodId: top?.[0] ?? null };
}
