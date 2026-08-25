export const dynamic = "force-dynamic";
import Link from "next/link";
import { Fragment } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { confirmCodAction, cancelCodAction } from "@/app/actions/billing";
import { isCodOrder } from "@/lib/orderPayment";
import { EditBillPanel } from "@/components/admin/EditBillPanel";

export const metadata = { title: "Owner Console · COD Orders" };

/**
 * COD ORDERS — Cash-on-Delivery orders placed on the storefront are HELD here: sellable stock is
 * RESERVED (so it cannot be sold twice) but they are NOT in the sales record yet. The owner packs
 * & dispatches, and once the customer has received and paid, hits "Confirm dispatched & received"
 * — only then does the reservation become a sale. Staff can edit quantities while it is held.
 */
export default async function CodOrders({ searchParams }: { searchParams?: { err?: string; ok?: string; cancelled?: string } }) {
  const sb = supabaseServer();
  const { data } = await sb
    .from("orders")
    .select("id,total,amount_paid,invoice_no,channel,customer_name,customer_phone,buyer_address,created_at,payment_mode,status")
    .eq("cod_hold", true)
    .order("created_at", { ascending: false })
    .limit(300);
  // Held-until-accept is shared with prepaid website orders. Only unpaid cash-on-delivery
  // belongs here — paid / online orders stay on Storefront Orders.
  const rows = ((data as any[]) ?? []).filter((r) =>
    isCodOrder(r) && String(r.status ?? "").toLowerCase() !== "cancelled");
  const pending = rows.reduce((s, r) => s + (r.total ?? 0), 0);

  const orderIds = rows.map((r) => r.id);
  const itemsByOrder = new Map<string, any[]>();
  if (orderIds.length) {
    const { data: its } = await sb.from("order_items")
      .select("id,order_id,qty,unit_price,line_total, product:products(name,sku), variant:variants(sku,color)")
      .in("order_id", orderIds);
    for (const it of ((its as any[]) ?? [])) { const a = itemsByOrder.get(it.order_id) ?? []; a.push(it); itemsByOrder.set(it.order_id, a); }
  }

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">COD Orders</h1>
      <p className="text-sm text-muted mb-5">
        Cash-on-Delivery orders from the storefront are held here — inventory is <b>reserved</b> for
        the customer (it will not show as available to anyone else) and they are
        <b> not</b> in the sales record yet. Prepaid (Razorpay/UPI) orders stay under{" "}
        <Link href="/admin/orders" className="text-emerald nav-link">Storefront Orders</Link> only.
        Pack &amp; dispatch, and once the customer has received &amp; paid, hit
        <b> Confirm dispatched &amp; received</b> — the reservation becomes a sale and the bill joins Sales.
        Admin can <b>edit</b> a held COD (qty / colour) without the owner OTP.
      </p>
      {searchParams?.err && <div className="rounded-2xl border border-rose/40 bg-rose/10 p-4 text-sm text-ink mb-4"><b>Couldn&apos;t confirm:</b> {searchParams.err}</div>}
      {searchParams?.ok && <div className="rounded-2xl border border-emerald/40 bg-emerald-mist p-4 text-sm text-emerald-dark mb-4">COD order confirmed — reservation converted to a sale, marked paid.</div>}
      {searchParams?.cancelled && <div className="rounded-2xl border border-sand bg-white p-4 text-sm text-muted mb-4">COD order cancelled. Reserved stock has been released back to the shelf.</div>}

      <div className="flex flex-wrap gap-3 mb-4">
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">COD orders to dispatch</p>
          <p className="text-2xl font-semibold text-ink">{rows.length}</p>
        </div>
        <div className="rounded-2xl border border-sand bg-white px-4 py-3 shadow-card">
          <p className="text-xs text-muted">Value held (to collect on delivery)</p>
          <p className="text-2xl font-semibold text-ink">{formatPaise(pending)}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr>
              <th className="p-3">Invoice / Order</th>
              <th className="p-3">Date</th>
              <th className="p-3">Customer &amp; address</th>
              <th className="p-3 text-right">Collect on delivery</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="p-4 text-muted">No COD orders waiting — every COD sale has been dispatched. 🎉</td></tr>
            )}
            {rows.map((r) => {
              const lines = itemsByOrder.get(r.id) ?? [];
              return (
                <Fragment key={r.id}>
                  <tr className="border-t border-sand/60 hover:bg-cream/40 align-top">
                    <td className="p-3">
                      <Link href={`/admin/invoice/${r.id}`} className="text-emerald nav-link font-medium">
                        {r.invoice_no || String(r.id).slice(0, 8).toUpperCase()} ↗
                      </Link>
                      <span className="block text-[11px] text-gold-dark mt-0.5">Cash on Delivery</span>
                    </td>
                    <td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</td>
                    <td className="p-3 text-ink">
                      {r.customer_name || "Customer"}
                      {r.customer_phone && <a href={`tel:${r.customer_phone}`} className="block text-xs text-emerald">{r.customer_phone}</a>}
                      {r.buyer_address && <span className="block text-xs text-muted mt-0.5 max-w-xs">{r.buyer_address}</span>}
                    </td>
                    <td className="p-3 text-right font-semibold whitespace-nowrap">{formatPaise(r.total)}</td>
                    <td className="p-3 text-right">
                      <div className="flex flex-col items-end gap-1.5">
                        <form action={confirmCodAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="px-3 py-1.5 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark whitespace-nowrap" title="Dispatched and customer has received/paid — converts the reservation into a sale">✓ Confirm dispatched &amp; received</button>
                        </form>
                        <Link href={`/admin/invoice/${r.id}`} className="px-3 py-1 rounded-full border border-sand text-ink text-[11px] hover:bg-cream whitespace-nowrap">✎ Edit order</Link>
                        <form action={cancelCodAction}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="px-3 py-1 rounded-full border border-rose/40 text-rose text-[11px] hover:bg-rose/10 whitespace-nowrap" title="Customer refused / no answer — releases reserved stock">Cancel order</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                  <tr className="border-t border-sand/30 bg-cream/20">
                    <td colSpan={5} className="px-3 pb-3 pt-0">
                      <div className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1 pt-2">
                        {lines.length === 0 && <span>No items on this order.</span>}
                        {lines.map((it: any) => (
                          <span key={it.id} className="text-ink">
                            <span className="font-mono text-muted">{it.variant?.sku ?? it.product?.sku ?? "—"}</span>
                            {it.variant?.color ? <span className="text-emerald-dark"> · {it.variant.color}</span> : null}
                            {" "}× {it.qty}
                          </span>
                        ))}
                      </div>
                      <div className="mt-3">
                        <EditBillPanel orderId={r.id} requireOtp={false} />
                      </div>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted mt-3">Pieces are reserved when the COD is placed, so KR52 cannot be sold twice. Confirming converts the hold into a sale; cancelling puts the pieces back on the shelf.</p>
    </main>
  );
}
