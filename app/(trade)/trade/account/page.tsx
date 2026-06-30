export const dynamic = "force-dynamic";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getWholesaleSession } from "@/lib/wholesale";
import { wholesaleLogoutAction } from "@/app/actions/wholesale";

export const metadata: Metadata = {
  title: "Trade Account",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TradeAccount() {
  const session = await getWholesaleSession();
  if (!session) redirect("/trade/login");

  return (
    <div className="max-w-2xl mx-auto px-5 py-8">
      <h1 className="font-display text-4xl text-ink mb-6">Account</h1>
      <div className="bg-white rounded-2xl border border-sand p-6">
        <dl className="space-y-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Dealer</dt><dd className="text-ink font-medium">{session.name}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Account type</dt><dd className="text-ink">Approved trade partner</dd></div>
        </dl>
        <p className="text-xs text-muted mt-5">Need to update your shop details or access code? Message us on WhatsApp: <a href="https://wa.me/919873151767" target="_blank" rel="noopener" className="text-emerald">+91 98731 51767</a></p>
      </div>
      <form action={wholesaleLogoutAction} className="mt-6">
        <button className="px-6 py-2.5 rounded-full bg-ink text-cream text-sm hover:bg-ink/90">Logout</button>
      </form>
    </div>
  );
}
