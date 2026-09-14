"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { useCart } from "@/components/cart/CartContext";
import { formatPaise } from "@/lib/pricing";
import { Back } from "@/components/site/Back";
import { placeOrderAction, checkCartStockAction } from "@/app/actions/orders";
import { createRazorpayOrderAction, confirmRazorpayAction } from "@/app/actions/checkoutOnline";
import { validateVoucherAction } from "@/app/actions/vouchers";
import { retailShippingPaise } from "@/lib/wholesaleShipping";

export default function Checkout() {
  const { items, total, clear, remove } = useCart();
  const router = useRouter();
  const [payment, setPayment] = useState<"cod" | "online">("online");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", phone: "", address: "", pincode: "", city: "" });
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const discount = applied ? Math.min(applied.discount, total) : 0;
  const discountedSubtotal = Math.max(0, total - discount);
  const shipping = retailShippingPaise(discountedSubtotal);
  const grandTotal = discountedSubtotal + shipping;

  useEffect(() => {
    const name = f.name.trim(); const phone = f.phone.trim();
    if (name.length < 2 || phone.replace(/\D/g, "").length < 7) return;
    const t = setTimeout(() => {
      try { localStorage.setItem("bd_retail_contact", JSON.stringify({ name, phone, city: f.city.trim() })); } catch { /* ignore */ }
    }, 800);
    return () => clearTimeout(t);
  }, [f.name, f.phone, f.city]);

  async function applyCoupon() {
    const code = coupon.trim();
    if (!code) return;
    setCouponBusy(true); setCouponMsg("");
    const res = await validateVoucherAction({ code, subtotalPaise: total, channel: "retail" });
    setCouponBusy(false);
    if (res.ok && res.discountPaise > 0) { setApplied({ code: res.code ?? code.toUpperCase(), discount: res.discountPaise }); setCouponMsg(res.message ?? "Coupon applied!"); }
    else { setApplied(null); setCouponMsg(res.message ?? "Invalid coupon code."); }
  }
  function removeCoupon() { setApplied(null); setCoupon(""); setCouponMsg(""); }

  // Retail storefront is PREPAID-ONLY (owner).
  useEffect(() => { setPayment("online"); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    const cartItems = items.map((i) => ({ sku: i.sku, qty: i.qty, color: i.color }));

    const stock = await checkCartStockAction(cartItems);
    if (!stock.ok) {
      const names = stock.unavailable.map((u) => {
        const it = items.find((x) => x.sku === u.sku && (x.color ?? null) === (u.color ?? null));
        return (it?.name ?? u.sku) + (u.color ? ` (${u.color})` : "");
      });
      stock.unavailable.forEach((u) => remove(u.sku, u.color ?? undefined));
      setBusy(false);
      setErr(`${names.join(", ")} just sold out and ${names.length > 1 ? "were" : "was"} removed from your bag. Please review your order and place it again.`);
      return;
    }

    // Pay Online only
    const created = await createRazorpayOrderAction(cartItems, f, applied?.code);
    if (!created.ok) { setBusy(false); setErr(created.error ?? "Couldn't start the payment."); return; }
    const RZP = (window as any).Razorpay;
    if (!RZP) { setBusy(false); setErr("Payment is still loading — please try again in a moment."); return; }
    const rzp = new RZP({
      key: created.keyId,
      amount: created.amount,
      currency: created.currency,
      order_id: created.orderId,
      name: "Blythe Diva",
      description: "Jewellery order",
      prefill: { name: f.name, contact: f.phone },
      notes: { address: f.address },
      theme: { color: "#0f766e" },
      handler: async (resp: any) => {
        setErr("");
        const conf = await confirmRazorpayAction({
          items: cartItems, customer: f,
          razorpay_order_id: resp.razorpay_order_id,
          razorpay_payment_id: resp.razorpay_payment_id,
          razorpay_signature: resp.razorpay_signature,
        });
        setBusy(false);
        if (!conf.ok) { setErr(conf.error ?? "We couldn't confirm your order — please contact us."); return; }
        clear(); router.push(`/order/${conf.orderId}`);
      },
      modal: { ondismiss: () => setBusy(false) },
    });
    rzp.on("payment.failed", (r: any) => {
      setBusy(false);
      setErr(r?.error?.description ?? "Payment failed. Please try again or use another card/UPI.");
    });
    rzp.open();
  }

  if (items.length === 0)
    return (
      <div className="max-w-2xl mx-auto px-5 py-20 text-center">
        <h1 className="font-display text-4xl text-ink">Your bag is empty</h1>
        <Link href="/shop" className="btn-primary inline-block mt-6 px-7 py-3 text-sm font-medium">Discover jewellery</Link>
      </div>
    );

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald transition-colors";
  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <Script src="https://checkout.razorpay.com/v1/checkout.js" strategy="afterInteractive" />
      <div className="mb-4"><Back label="Back to shopping" /></div>
      <h1 className="font-display text-4xl text-ink mb-6">Checkout</h1>
      <div className="grid md:grid-cols-2 gap-10">
        <form onSubmit={submit} className="space-y-3">
          <h2 className="font-medium text-ink">Delivery details</h2>
          <input className={input} placeholder="Full name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input className={input} placeholder="Phone (WhatsApp)" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} required />
          <textarea className={input} placeholder="Full address" rows={3} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} required />
          <div className="grid grid-cols-2 gap-3">
            <input className={input} placeholder="Pincode" value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} />
            <input className={input} placeholder="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          </div>
          <h2 className="font-medium text-ink pt-2">Payment</h2>
          <div className="rounded-xl border border-emerald bg-emerald-mist text-emerald-dark px-3 py-2.5 text-sm flex items-center gap-2">
            <span className="text-lg">🎁</span>
            <span>Pay online (UPI / Card / Netbanking) — a <b>free mystery gift</b> is added to your parcel.</span>
          </div>
          <div className="rounded-xl border border-emerald bg-white px-4 py-3 text-sm">
            <span className="font-medium block text-ink">Pay Online</span>
            <span className="text-xs text-muted">UPI / Card / Netbanking · secure checkout</span>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted pt-0.5">
            <span>🔒 100% secure checkout</span><span>· 10,000+ happy customers</span><span>· Easy 7-day returns</span>
          </p>

          {err && <p className="text-sm text-rose">{err}</p>}
          <button disabled={busy} className="btn-primary w-full py-3.5 text-sm font-medium disabled:opacity-60">
            {busy ? "Placing order…" : `Place order · ${formatPaise(grandTotal)}`}
          </button>
        </form>

        <div className="bg-white rounded-2xl p-6 shadow-card h-fit">
          <h2 className="font-medium text-ink mb-4">Order summary</h2>
          <div className="space-y-3 mb-4">
            {items.map((i) => (
              <div key={i.sku + (i.color ?? "")} className="flex justify-between text-sm">
                <span className="text-ink/80">{i.name}{i.color ? ` · ${i.color}` : ""} × {i.qty}</span>
                <span className="text-ink">{formatPaise(i.price * i.qty)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-sand pt-3 mb-3">
            {applied ? (
              <div className="flex items-center justify-between rounded-xl bg-emerald-mist px-3 py-2">
                <span className="text-sm text-emerald-dark">Coupon <b>{applied.code}</b> applied</span>
                <button type="button" onClick={removeCoupon} className="text-xs text-rose nav-link">Remove</button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Coupon code"
                  className="flex-1 rounded-xl border border-sand px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-emerald" />
                <button type="button" onClick={applyCoupon} disabled={couponBusy || !coupon.trim()}
                  className="px-4 py-2 rounded-xl bg-ink text-cream text-sm font-medium disabled:opacity-50">{couponBusy ? "…" : "Apply"}</button>
              </div>
            )}
            {couponMsg && <p className={`text-xs mt-1.5 ${applied ? "text-emerald-dark" : "text-rose"}`}>{couponMsg}</p>}
          </div>
          <div className="border-t border-sand pt-3 space-y-1 text-sm">
            <div className="flex justify-between text-muted"><span>Subtotal</span><span>{formatPaise(total)}</span></div>
            {discount > 0 && <div className="flex justify-between text-emerald-dark"><span>Discount{applied ? ` (${applied.code})` : ""}</span><span>−{formatPaise(discount)}</span></div>}
            <div className="flex justify-between text-muted"><span>Shipping</span><span>{shipping === 0 ? "Free" : formatPaise(shipping)}</span></div>
            <div className="flex justify-between font-semibold text-ink pt-1"><span>Total</span><span>{formatPaise(grandTotal)}</span></div>
          </div>

          <a
            href={`https://wa.me/918700091298?text=${encodeURIComponent("Hi Blythe Diva! I'm at checkout and have a question about my order 🙂")}`}
            target="_blank" rel="noreferrer"
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-full bg-[#25D366] text-white py-3 text-sm font-semibold shadow-luxe hover:brightness-105 active:scale-[0.99] transition"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.5-.1-.7.2-.2.3-.7.8-.9 1-.2.2-.3.2-.6.1-1.5-.8-2.5-1.4-3.5-3.1-.3-.5.3-.4.7-1.3.1-.2 0-.4 0-.5 0-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.8.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.3zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2z" /></svg>
            Questions? Chat with us on WhatsApp
          </a>
          <p className="text-[11px] text-muted text-center mt-1.5">Not sure? Message us — we reply in minutes and can even take your order on WhatsApp.</p>
        </div>
      </div>
    </div>
  );
}
