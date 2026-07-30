import type { Metadata } from "next";
import { getWholesaleSession } from "@/lib/wholesale";
import { getLivePromos } from "@/lib/supabase/queries";
import { TradeHeader } from "@/components/trade/TradeHeader";
import { PromoPopup } from "@/components/site/PromoPopup";
import { BUSINESS } from "@/lib/business";

export const dynamic = "force-dynamic";

// SEO: the dealer portal must never be indexed or followed by crawlers.
export const metadata: Metadata = {
  title: "Trade Portal",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TradeLayout({ children }: { children: React.ReactNode }) {
  // Header is hidden on the login screen (no session yet); pages enforce their own auth.
  const session = await getWholesaleSession();
  const popup = session ? (await getLivePromos("wholesale", "popup").catch(() => []))[0] ?? null : null;
  return (
    <div className="min-h-screen flex flex-col bg-ivory">
      {session && <TradeHeader dealerName={session.name} />}
      <main className="flex-1">{children}</main>
      {/* Business identity footer — legal name, registered address, GSTIN & contact + policy links, so
          the wholesale portal also passes Meta / WhatsApp Business verification. Policy links point to the
          main domain where those pages live. */}
      <footer className="bg-ink text-cream/50 text-xs py-8 mt-10">
        <div className="max-w-5xl mx-auto px-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1 leading-relaxed">
            <p className="text-cream/80 font-medium">{BUSINESS.brand} · {BUSINESS.legalName}</p>
            <p>{BUSINESS.address}</p>
            <p>GSTIN: {BUSINESS.gstin}</p>
            <p>
              <a href={`mailto:${BUSINESS.email}`} className="hover:text-gold">{BUSINESS.email}</a>
              {" · "}
              <a href={`tel:${BUSINESS.phone.replace(/\s/g, "")}`} className="hover:text-gold">{BUSINESS.phone}</a>
            </p>
          </div>
          <div className="space-y-1 sm:text-right">
            <p className="text-cream/40">Trade Portal · Authorised dealers only</p>
            <p className="space-x-3">
              <a href="https://blythediva.com" className="hover:text-gold">Retail store</a>
              <a href="https://blythediva.com/privacy" className="hover:text-gold">Privacy</a>
              <a href="https://blythediva.com/terms" className="hover:text-gold">Terms</a>
              <a href="https://blythediva.com/contact" className="hover:text-gold">Contact</a>
            </p>
            <p className="text-cream/30">© 2026 {BUSINESS.legalName}. All rights reserved.</p>
          </div>
        </div>
      </footer>
      <PromoPopup promo={popup as any} />
    </div>
  );
}
