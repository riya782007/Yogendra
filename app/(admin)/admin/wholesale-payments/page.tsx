export const dynamic = "force-dynamic";
import { getPendingWholesalePayments } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { WholesalePaymentCard } from "@/components/admin/WholesalePaymentCard";
import { getSession, can } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata = { title: "Owner Console · Wholesale Payments" };

export default async function WholesalePayments() {
  const session = getSession();
  if (!can(session, "billing.sell")) redirect("/admin/dashboard");
  const orders = await getPendingWholesalePayments();
  const pendingValue = orders.reduce((s, o) => s + (o.total ?? 0), 0);

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Wholesale Payments</h1>
      <p className="text-sm text-muted mb-6">
        Dealers pay by scanning your UPI QR and upload the screenshot. Verify each one here — tap the screenshot to enlarge, then <b className="text-emerald-dark">Approve</b> to mark it received, or <b className="text-rose">Reject</b> to follow up.
        {orders.length > 0 && <> <span className="text-ink font-medium">{orders.length}</span> awaiting · <span className="text-gold-dark font-medium">{formatPaise(pendingValue)}</span> to confirm.</>}
      </p>

      <div className="space-y-3">
        {orders.length === 0 && (
          <p className="text-sm text-muted bg-white rounded-2xl border border-sand p-6 text-center">No wholesale payments waiting for approval. New ones show here the moment a dealer places a prepaid order.</p>
        )}
        {orders.map((o) => <WholesalePaymentCard key={o.id} order={o} />)}
      </div>
    </main>
  );
}
