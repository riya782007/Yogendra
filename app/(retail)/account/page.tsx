export const dynamic = "force-dynamic";
import Link from "next/link";
import { getOrder, getOrderTracking, getCustomerProfile, getCustomerOrders } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { Back } from "@/components/site/Back";
import { TrackForm } from "@/components/site/TrackForm";
import { OrderTimeline } from "@/components/site/OrderTimeline";
import { CustomerLogin } from "@/components/site/CustomerLogin";
import { getCustomerSession } from "@/lib/customerAuth";
import { logoutCustomerAction } from "@/app/actions/customerAuth";

export const metadata = { title: "My Account", robots: { index: false } };

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default async function Account({ searchParams }: { searchParams: { order?: string; track?: string; o?: string; p?: string } }) {
  const id = searchParams.order?.trim();
  const lookupKey = searchParams.o?.trim();
  const lookupPhone = searchParams.p?.trim();

  // ---- 1) Order tracking — from a confirmation link (?order=<uuid>) OR the track form
  //         (?o=<order id / invoice>&p=<phone>, which also accepts the short 8-char code). ----
  if (id || (lookupKey && lookupPhone)) {
    const data = id
      ? await getOrder(id)
      : await (async () => { const r = await getOrderTracking(lookupKey!, lookupPhone!); return "order" in r ? r : null; })();
    return (
      <div className="max-w-xl mx-auto px-5 py-12">
        <div className="mb-5"><Back label="Back" /></div>
        <h1 className="font-display text-4xl text-ink mb-1">Track Your Order</h1>
        {!data ? (
          <div className="bg-white rounded-2xl shadow-card p-6 mt-4">
            <p className="text-ink">We couldn&apos;t find that order.</p>
            <p className="text-sm text-muted mt-1">Check the order ID and the phone number used on the order, or <a href="https://wa.me/918700091298" className="text-emerald nav-link">WhatsApp us</a> and we&apos;ll help.</p>
            <div className="mt-4"><TrackForm /></div>
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-muted mb-5">Order <span className="font-mono text-ink">{data.order.invoice_no || String(data.order.id).slice(0, 8).toUpperCase()}</span> · {day(data.order.created_at)}</p>
            <div className="bg-white rounded-2xl p-6 shadow-card"><OrderTimeline order={data.order} /></div>
            <div className="bg-white rounded-2xl p-6 shadow-card mt-4">
              <h2 className="font-medium text-ink mb-3">Items</h2>
              <div className="space-y-2">
                {(data.items ?? []).map((it: any, i: number) => (
                  <div key={i} className="flex justify-between text-sm"><span className="text-ink/80">{it.product?.name} <span className="text-muted">× {it.qty}</span></span><span className="text-ink">{formatPaise(it.line_total)}</span></div>
                ))}
              </div>
              <div className="border-t border-sand mt-3 pt-3 flex justify-between font-semibold text-ink"><span>Total ({String(data.order.payment_mode).toUpperCase()})</span><span>{formatPaise(data.order.total)}</span></div>
            </div>
            <div className="text-center mt-6"><Link href="/account" className="text-sm text-emerald nav-link">← My account</Link></div>
          </div>
        )}
      </div>
    );
  }

  const session = getCustomerSession();

  // ---- 2) Standalone "track an order" (no sign-in needed) ----
  if (searchParams.track === "1") {
    return (
      <div className="max-w-xl mx-auto px-5 py-12">
        <div className="mb-5"><Back label="Back" /></div>
        <h1 className="font-display text-4xl text-ink mb-1">Track Your Order</h1>
        <p className="text-muted mb-6">Enter your order ID (from your confirmation) and the phone number used on the order to see its status.</p>
        <TrackForm />
        <div className="text-center mt-6 text-sm text-muted"><Link href="/account" className="text-emerald nav-link">← Back to account</Link></div>
      </div>
    );
  }

  // ---- 3) Not signed in → login ----
  if (!session) {
    return (
      <div className="max-w-md mx-auto px-5 py-12">
        <div className="mb-5"><Back label="Back" /></div>
        <h1 className="font-display text-4xl text-ink mb-1">My Account</h1>
        <p className="text-muted mb-6">Sign in to see your orders and saved items.</p>
        <CustomerLogin />
        <div className="text-center mt-6 text-sm text-muted">Just want to track an order? <Link href="/account?track=1" className="text-emerald nav-link">Track without signing in</Link></div>
      </div>
    );
  }

  // ---- 4) Signed in → profile + orders + logout ----
  const [profile, orders] = await Promise.all([getCustomerProfile(session.phone), getCustomerOrders(session.phone)]);
  const statusStyle = (s: string | null, paid: boolean) => paid ? "bg-emerald-mist text-emerald-dark" : "bg-gold/15 text-gold-dark";

  return (
    <div className="max-w-2xl mx-auto px-5 py-12">
      <div className="mb-5"><Back label="Back" /></div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl text-ink mb-1">My Account</h1>
          <p className="text-muted">{profile?.name && profile.name !== session.phone ? profile.name : "Welcome"} · +91 {session.phone}</p>
        </div>
        <form action={logoutCustomerAction}><button className="text-sm text-muted hover:text-rose whitespace-nowrap">Log out →</button></form>
      </div>

      <div className="flex flex-wrap gap-3 mt-4">
        <Link href="/wishlist" className="px-4 py-2 rounded-xl bg-white border border-sand text-sm text-ink hover:border-emerald">♡ My Wishlist</Link>
        <Link href="/account?track=1" className="px-4 py-2 rounded-xl bg-white border border-sand text-sm text-ink hover:border-emerald">Track an order</Link>
        <Link href="/shop" className="px-4 py-2 rounded-xl bg-white border border-sand text-sm text-ink hover:border-emerald">Continue shopping</Link>
      </div>

      <h2 className="font-display text-2xl text-ink mt-8 mb-3">My Orders</h2>
      {orders.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-card p-6 text-center">
          <p className="text-muted">No orders yet.</p>
          <Link href="/shop" className="btn-primary inline-block mt-3 px-6 py-2.5 text-sm font-medium">Start shopping</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const paid = (o.amount_paid ?? 0) >= (o.total ?? 0) && (o.total ?? 0) > 0;
            return (
              <Link key={o.id} href={`/account?order=${o.id}`} className="block bg-white rounded-2xl p-4 shadow-card hover:shadow-luxe transition">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-sm text-ink">{o.invoice_no || String(o.id).slice(0, 8).toUpperCase()}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${statusStyle(o.status, paid)}`}>{paid ? "Paid" : (o.status || "Placed")}</span>
                </div>
                <div className="flex items-center justify-between mt-1.5 text-sm">
                  <span className="text-muted">{day(o.created_at)}{o.channel ? ` · ${o.channel}` : ""}</span>
                  <span className="font-semibold text-ink">{formatPaise(o.total)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
