"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Script from "next/script";
import { useCart } from "@/components/cart/CartContext";
import { formatPaise } from "@/lib/pricing";
import { Back } from "@/components/site/Back";
import { placeOrderAction } from "@/app/actions/orders";
import { createRazorpayOrderAction, confirmRazorpayAction } from "@/app/actions/checkoutOnline";
import { validateVoucherAction } from "@/app/actions/vouchers";

export default function Checkout() {
  const { items, total, clear } = useCart();
  const router = useRouter();
  const [payment, setPayment] = useState<"cod" | "online">("cod");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: "", phone: "", address: "", pincode: "", city: "" });
  // Coupon / voucher — validated server-side; the discount is re-checked again at order time.
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<{ code: string; discount: number } | null>(null);
  const [couponMsg, setCouponMsg] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const discount = applied ? Math.min(applied.discount, total) : 0;
  const discountedSubtotal = Math.max(0, total - discount);
  const shipping = discountedSubtotal === 0 ? 0 : 10000; // flat ₹100 shipping on every order
  // COD rules (owner): a flat ₹120 handling fee per COD order, and NO COD on orders above ₹5,000.
  const COD_FEE = 12000;
  const codAllowed = discountedSubtotal > 0 && discountedSubtotal <= 500000;
  const codFee = payment === "cod" && codAllowed ? COD_FEE : 0;
  const grandTotal = discountedSubtotal + shipping + codFee;

  // Persist the typed contact so even an ABANDONED checkout surfaces WITH a name + phone on the owner's
  // Abandoned Carts page (CartContext reads this and attaches it to the tracked cart).
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

  // Honour the method chosen via a "Buy Now" / "Cash on Delivery" button on the product page
  // (e.g. /checkout?pay=online). Read from the URL on mount to avoid a Suspense boundary.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("pay");
    if (p === "online" || p === "cod") setPayment(p);
  }, []);

  // Orders above ₹5,000 can't be COD — flip such a cart to online automatically.
  useEffect(() => { if (!codAllowed && payment === "cod") setPayment("online"); }, [codAllowed, payment]);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(""); setBusy(true);
    const cartItems = items.map((i) => ({ sku: i.sku, qty: i.qty, color: i.color }));

    // ---- Pay Online (Razorpay) ----
    if (payment === "online") {
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
        setErr(r?.error?.description ?? "Payment failed. Please try again or choose Cash on Delivery.");
      });
      rzp.open();
      return; // stays busy until the modal resolves
    }

    // ---- Cash on Delivery ----
    const res = await placeOrderAction({ items: cartItems, customer: f, payment, voucher: applied?.code });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Something went wrong"); return; }
    clear(); router.push(`/order/${res.orderId}`);
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
          <div className="grid grid-cols-2 gap-3">
            {(["cod", "online"] as const).map((p) => {
              const disabled = p === "cod" && !codAllowed;
              return (
                <button type="button" key={p} disabled={disabled} onClick={() => !disabled && setPayment(p)}
                  className={`rounded-xl border px-4 py-3 text-sm text-left transition-all ${payment === p ? "border-emerald bg-emerald-mist" : "border-sand hover:border-gold"} ${disabled ? "opacity-40 cursor-not-allowed" : ""}`}>
                  <span className="font-medium block text-ink">{p === "cod" ? "Cash on Delivery" : "Pay Online"}</span>
                  <span className="text-xs text-muted">{p === "cod" ? (disabled ? "Not available above ₹5,000" : "Pay when it arrives · +₹120 fee") : "UPI / Card / Netbanking"}</span>
                </button>
              );
            })}
          </div>
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
          {/* Coupon / voucher */}
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
            {codFee > 0 && <div className="flex justify-between text-muted"><span>COD handling fee</span><span>{formatPaise(codFee)}</span></div>}
            <div className="flex justify-between font-semibold text-ink pt-1"><span>Total</span><span>{formatPaise(grandTotal)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
