export const dynamic = "force-dynamic";
import { BUSINESS } from "@/lib/business";
import { FeedbackForm } from "@/components/site/FeedbackForm";

export const metadata = { title: "Share your feedback — Blythe Diva" };

export default function FeedbackPage({ searchParams }: { searchParams: { ref?: string } }) {
  const phone = BUSINESS.phone.replace(/\D/g, "").slice(-10);
  return (
    <main className="min-h-screen bg-ivory grid place-items-center p-5">
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-luxe p-7">
        <p className="text-[10px] tracking-[0.3em] uppercase text-gold-dark">{BUSINESS.brand}</p>
        <h1 className="font-display text-4xl text-ink mt-1">How did we do?</h1>
        <p className="text-sm text-muted mt-1 mb-5">Your feedback helps us serve you better — it takes 20 seconds 💛</p>
        <FeedbackForm storePhone={phone} orderRef={searchParams.ref ?? ""} />
      </div>
    </main>
  );
}
