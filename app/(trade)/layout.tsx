import type { Metadata } from "next";
import { getWholesaleSession } from "@/lib/wholesale";
import { TradeHeader } from "@/components/trade/TradeHeader";

export const dynamic = "force-dynamic";

// SEO: the dealer portal must never be indexed or followed by crawlers.
export const metadata: Metadata = {
  title: "Trade Portal",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TradeLayout({ children }: { children: React.ReactNode }) {
  // Header is hidden on the login screen (no session yet); pages enforce their own auth.
  const session = await getWholesaleSession();
  return (
    <div className="min-h-screen flex flex-col bg-ivory">
      {session && <TradeHeader dealerName={session.name} />}
      <main className="flex-1">{children}</main>
      <footer className="bg-ink text-cream/50 text-center text-xs py-6 mt-10">
        Blythe Diva · Trade Portal · Authorised dealers only
      </footer>
    </div>
  );
}
