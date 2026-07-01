export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getWholesaleSession } from "@/lib/wholesale";
import { wholesaleLoginAction } from "@/app/actions/wholesale";

export const metadata: Metadata = {
  title: "Dealer Sign In",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TradeLogin({ searchParams }: { searchParams: { error?: string } }) {
  // Already an approved dealer → straight to the dashboard.
  if (await getWholesaleSession()) redirect("/trade");

  return (
    <div className="max-w-5xl mx-auto px-5 py-12">
      <section className="rounded-3xl bg-ink text-cream px-6 sm:px-8 py-10 sm:py-12 relative overflow-hidden mb-8">
        <div className="absolute inset-0 opacity-25" style={{ background: "radial-gradient(circle at 15% 20%, #C8A24C, transparent 38%), radial-gradient(circle at 85% 90%, #0F5C4D, transparent 42%)" }} />
        <div className="relative max-w-2xl">
          <p className="text-gold-light tracking-[0.3em] uppercase text-xs">Blythe Diva · Trade</p>
          <h1 className="font-display text-4xl sm:text-5xl mt-2 leading-tight break-words">Dealer Portal</h1>
          <p className="text-cream/70 mt-3">Factory-direct rates from Sadar Bazar. Approved dealers sign in to see trade pricing and place orders.</p>
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <form action={wholesaleLoginAction} className="bg-white rounded-2xl shadow-card p-7 border border-sand">
          <h2 className="font-display text-2xl text-ink mb-1">Dealer sign in</h2>
          <p className="text-xs text-muted mb-5">Use the phone number and access code your supplier gave you.</p>
          <input name="phone" placeholder="Registered phone number" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald mb-3" />
          <input name="code" placeholder="Access code" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald uppercase tracking-widest" />
          {searchParams.error && <p className="text-sm text-rose mt-2">Wrong phone or code, or your account isn&apos;t approved yet.</p>}
          <button className="btn-primary w-full mt-4 py-3 text-sm font-medium">Sign in to trade pricing</button>
        </form>

        <div className="bg-emerald-mist/60 rounded-2xl p-7 border border-emerald/20">
          <h2 className="font-display text-2xl text-emerald-dark mb-2">Become a dealer</h2>
          <p className="text-sm text-emerald-dark/80">Trade pricing is unlocked only after we verify your shop — this protects everyone&apos;s margins. To get an access code, message us with your shop name and GST number:</p>
          <a href="https://wa.me/919873151767" target="_blank" rel="noopener" className="btn-gold inline-block px-6 py-3 text-sm font-medium mt-4">Request access on WhatsApp</a>
        </div>
      </div>
    </div>
  );
}
