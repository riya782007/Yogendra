export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import { VisitorCard } from "@/components/admin/VisitorCard";

export const metadata = { title: "Owner Console · Trade Visitors" };

export default async function TradeVisitors() {
  const sb = supabaseServer();
  const { data } = await (sb.from("trade_visitors") as any).select("*").order("created_at", { ascending: false }).limit(300);
  const list = ((data as any[]) ?? []);
  const fresh = list.filter((v) => v.status === "new");
  const rest = list.filter((v) => v.status !== "new");

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Trade Visitors</h1>
      <p className="text-sm text-muted mb-6">
        The wholesale catalogue is open to browse — no sign-in needed, so dealers don&apos;t bounce before
        seeing a single rate. Once someone has genuinely browsed, we ask for their name, number and city.
        Everyone who left details lands here, with how much they actually looked at, so you know who&apos;s worth a call.
      </p>

      {list.length === 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <p className="text-sm text-muted">No visitor details captured yet. They&apos;ll appear here as dealers browse the trade catalogue.</p>
        </div>
      )}

      {fresh.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wide text-muted mb-2">New — worth a call ({fresh.length})</h2>
          <div className="space-y-3 mb-8">{fresh.map((v) => <VisitorCard key={v.id} v={v} />)}</div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Followed up</h2>
          <div className="space-y-3">{rest.map((v) => <VisitorCard key={v.id} v={v} />)}</div>
        </>
      )}
    </main>
  );
}
