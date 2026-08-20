export const dynamic = "force-dynamic";
/**
 * Storefront Orders — the owner's dedicated queue for WEBSITE orders (retail + wholesale panel),
 * separate from the POS sales register ("sales me wo samajh nahi ayega"). Every new order shows
 * prepaid/online only (COD has its own queue), the customer's details + delivery address and the exact items, with one-tap
 * ACCEPT (confirms + WhatsApps the customer) or REJECT (cancels properly: restock + revenue
 * reversal + customer notified).
 */
import Link from "next/link";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { acceptStorefrontOrderAction, rejectStorefrontOrderAction, dispatchStorefrontOrderAction, deliverStorefrontOrderAction } from "@/app/actions/orders";
import { isPrepaidOrder } from "@/lib/orderPayment";

export const metadata = { title: "Owner Console · Storefront Orders" };

const CH_STYLE: Record<string, string> = {
  retail: "bg-emerald-mist text-emerald-dark",
  wholesale: "bg-gold/15 text-gold-dark",
};

export default async function StorefrontOrders({ searchParams }: { searchParams?: { tab?: string } }) {
  const sb = supabaseServer();
  const tab = searchParams?.tab === "handled" ? "handled" : "new";
  let rows: any[] = [];
  let migrationMissing = false;
  {
    const q = sb.from("orders")
      .select("id,invoice_no,channel,total,amount_paid,payment_mode,bill_type,status,fulfillment,customer_name,customer_phone,buyer_address,payment_ref,payment_proof_path,courier_name,tracking_no,tracking_url,created_at, order_items(qty, product:products(name,sku), variant:variants(sku,color))")
      .neq("channel", "pos")
      .order("created_at", { ascending: false })
      .limit(100);
    const { data, error } = tab === "new"
      ? await q.is("fulfillment", null).neq("status", "cancelled")
      : await q.not("fulfillment", "is", null);
    if (error && /fulfillment/i.test(error.message ?? "")) migrationMissing = true;
    rows = ((data as any[]) ?? []).filter((r) => isPrepaidOrder(r));
  }

  // Thumbnails per item — the order used to show a cramped comma-line of names ("list with images"
  // request). Resolve each SKU to the colour's own photo, else the parent product's first image.
  const imgByUpper = new Map<string, string>();
  const allSkus = Array.from(new Set(rows.flatMap((r: any) =>
    ((r.order_items as any[]) ?? []).flatMap((it: any) => [it.variant?.sku, it.product?.sku].filter(Boolean)))));
  if (allSkus.length) {
    const firstHttp = (arr: any[]) => (arr ?? []).filter((i: any) => typeof i?.path === "string" && i.path.startsWith("http")).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.path as string | undefined;
    const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
    for (const grp of chunk(allSkus as string[], 60)) {
      const or = grp.map((s) => `sku.ilike.${String(s).replace(/[,()]/g, "")}`).join(",");
      const [{ data: vs }, { data: ps }] = await Promise.all([
        sb.from("variants").select("sku,image_paths, product:products(images:product_images(path,sort))").or(or),
        sb.from("products").select("sku, images:product_images(path,sort)").or(or),
      ]);
      for (const p of ((ps as any[]) ?? [])) { const img = firstHttp(p.images); if (img) imgByUpper.set(String(p.sku).toUpperCase(), img); }
      for (const v of ((vs as any[]) ?? [])) {
        const vimg = ((v.image_paths as string[]) ?? []).find((u: string) => typeof u === "string" && u.startsWith("http"));
        const img = vimg ?? firstHttp(v.product?.images);
        if (img && !imgByUpper.has(String(v.sku).toUpperCase())) imgByUpper.set(String(v.sku).toUpperCase(), img);
      }
    }
  }
  const imgFor = (it: any) => imgByUpper.get(String(it.variant?.sku ?? "").toUpperCase()) ?? imgByUpper.get(String(it.product?.sku ?? "").toUpperCase());

  const tabCls = (k: string) => `px-3.5 py-1.5 rounded-full text-sm ${tab === k ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-emerald"}`;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Storefront Orders</h1>
      <p className="text-sm text-muted mb-4">Prepaid website orders (shop + wholesale panel) — separate from POS sales and from COD. Cash-on-Delivery lives only under <Link href="/admin/cod" className="text-emerald nav-link">COD Orders</Link>. Accept to confirm &amp; pack; Reject cancels the bill, restocks and informs the customer.</p>

      {migrationMissing ? (
        <div className="rounded-2xl border border-gold/40 bg-gold/10 p-5 text-sm text-ink">
          <p className="font-medium mb-1">One-time setup needed</p>
          <p className="text-muted">Run <code className="bg-white px-1 rounded border border-sand">supabase/migrations/0049_order_fulfillment.sql</code> (adds the accept/reject column), then reload.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-4">
            <Link href="/admin/orders" className={tabCls("new")}>🆕 New</Link>
            <Link href="/admin/orders?tab=handled" className={tabCls("handled")}>Handled</Link>
          </div>

          {rows.length === 0 && <p className="text-muted text-sm bg-white rounded-2xl border border-sand p-6">Nothing here — {tab === "new" ? "no new website orders waiting. 🎉" : "no handled orders yet."}</p>}

          <div className="space-y-3">
            {rows.map((r) => {
              const paid = r.amount_paid ?? 0;
              const prepaid = paid >= (r.total ?? 0) && (r.total ?? 0) > 0;
              const items = ((r.order_items as any[]) ?? []);
              return (
                <div key={r.id} className="rounded-2xl border border-sand bg-white shadow-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/admin/invoice/${r.id}`} className="text-emerald nav-link font-medium">{r.invoice_no || String(r.id).slice(0, 8).toUpperCase()} ↗</Link>
                        <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${CH_STYLE[r.channel] ?? "bg-cream text-muted"}`}>{r.channel}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs ${prepaid ? "bg-emerald-mist text-emerald-dark" : paid > 0 ? "bg-gold/15 text-gold-dark" : "bg-gold/15 text-gold-dark"}`}>
                          {prepaid ? "PREPAID ✓" : paid > 0 ? `Part-paid ${formatPaise(paid)}` : "Unpaid — prepaid"}
                        </span>
                        {r.payment_ref && <span className="text-[11px] text-muted font-mono">ref {r.payment_ref}</span>}
                        {r.status === "cancelled" && <span className="px-2 py-0.5 rounded-full text-xs bg-rose/10 text-rose">Cancelled</span>}
                        {r.fulfillment === "accepted" && r.status !== "dispatched" && r.status !== "delivered" && <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-mist text-emerald-dark">Accepted ✓</span>}
                        {r.fulfillment === "rejected" && <span className="px-2 py-0.5 rounded-full text-xs bg-rose/10 text-rose">Rejected</span>}
                        {r.status === "dispatched" && <span className="px-2 py-0.5 rounded-full text-xs bg-gold/15 text-gold-dark">Dispatched 📦</span>}
                        {r.status === "delivered" && <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-mist text-emerald-dark">Delivered ✓</span>}
                      </div>
                      <p className="text-sm text-ink mt-1.5">
                        <b>{r.customer_name || "Walk-in"}</b>{r.customer_phone ? ` · ${r.customer_phone}` : ""}
                        <span className="text-muted"> · {new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </p>
                      {r.buyer_address && <p className="text-xs text-muted mt-0.5">📦 {r.buyer_address}</p>}
                      {r.payment_proof_path && (
                        <a href={r.payment_proof_path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 mt-1.5 group/proof" title="Open the payment screenshot the buyer uploaded">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.payment_proof_path} alt="Payment screenshot" className="h-12 w-12 object-cover rounded-lg border border-sand group-hover/proof:ring-2 ring-emerald" />
                          <span className="text-xs text-emerald nav-link">📷 Payment screenshot ↗</span>
                        </a>
                      )}
                      {/* Items as a readable list — each on its own line with its photo, colour and qty. */}
                      <div className="mt-2.5 grid gap-1.5">
                        {items.length === 0 && <p className="text-sm text-muted">—</p>}
                        {items.map((it: any, i: number) => {
                          const img = imgFor(it);
                          return (
                            <div key={i} className="flex items-center gap-2.5">
                              <div className="h-12 w-11 rounded-lg overflow-hidden bg-cream border border-sand shrink-0">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {img ? <img src={img} alt="" className="w-full h-full object-cover" /> : <span className="flex items-center justify-center h-full text-[10px] text-muted">—</span>}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm text-ink leading-tight">{it.product?.name ?? it.variant?.sku ?? "item"}{it.variant?.color ? <span className="text-muted"> · {it.variant.color}</span> : ""}</p>
                                <p className="text-xs text-muted"><span className="font-mono">{it.variant?.sku ?? it.product?.sku}</span> · Qty <b className="text-ink">{it.qty}</b></p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xl font-semibold text-ink">{formatPaise(r.total ?? 0)}</p>
                      {/* Printable packing slip (browser Print → Save as PDF) for staff to pack & dispatch. */}
                      <Link href={`/admin/orders/${r.id}/pack`} target="_blank" className="inline-block mt-1 text-xs px-3 py-1 rounded-full border border-sand text-ink hover:border-emerald">🖨️ Packing slip PDF</Link>
                      {tab === "new" && (
                        <div className="flex gap-2 mt-2">
                          <form action={acceptStorefrontOrderAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="px-3.5 py-1.5 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark">✓ Accept</button>
                          </form>
                          <form action={rejectStorefrontOrderAction}>
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="reason" value="Rejected by store" />
                            <button className="px-3.5 py-1.5 rounded-full border border-rose/40 text-rose text-xs font-medium hover:bg-rose/10">✕ Reject</button>
                          </form>
                        </div>
                      )}
                      {/* Dispatch / deliver — moves the customer's tracker + WhatsApps them. */}
                      {r.fulfillment === "accepted" && r.status !== "cancelled" && r.status !== "delivered" && (
                        <div className="mt-2 flex flex-col items-end gap-1.5">
                          {r.status !== "dispatched" ? (
                            <details className="text-left">
                              <summary className="cursor-pointer list-none inline-block px-3.5 py-1.5 rounded-full bg-ink text-white text-xs font-medium hover:bg-ink/90">📦 Dispatch</summary>
                              <form action={dispatchStorefrontOrderAction} className="mt-2 w-64 bg-cream/60 rounded-xl p-3 space-y-2">
                                <input type="hidden" name="id" value={r.id} />
                                <input name="courier" placeholder="Courier (e.g. Delhivery)" className="w-full rounded-lg border border-sand px-3 py-1.5 text-xs outline-none focus:border-emerald" />
                                <input name="trackingNo" placeholder="Tracking / AWB no." className="w-full rounded-lg border border-sand px-3 py-1.5 text-xs outline-none focus:border-emerald" />
                                <input name="trackingUrl" placeholder="Tracking link (optional)" className="w-full rounded-lg border border-sand px-3 py-1.5 text-xs outline-none focus:border-emerald" />
                                <button className="w-full px-3 py-1.5 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark">Mark dispatched + WhatsApp</button>
                              </form>
                            </details>
                          ) : (
                            <form action={deliverStorefrontOrderAction}>
                              <input type="hidden" name="id" value={r.id} />
                              <button className="px-3.5 py-1.5 rounded-full bg-emerald text-white text-xs font-medium hover:bg-emerald-dark">✓ Mark delivered</button>
                            </form>
                          )}
                          {r.tracking_no && <span className="text-[11px] text-muted">AWB: <span className="font-mono">{r.tracking_no}</span></span>}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </main>
  );
}
