export const dynamic = "force-dynamic";
import { supabaseServer } from "@/lib/supabase/server";
import { DesignEnquiryCard } from "@/components/admin/DesignEnquiryCard";

export const metadata = { title: "Owner Console · Design Enquiries" };

export default async function DesignEnquiries() {
  const sb = supabaseServer();
  const { data } = await (sb.from("design_enquiries") as any).select("*").order("created_at", { ascending: false }).limit(300);
  const list = ((data as any[]) ?? []);
  const open = list.filter((e) => e.status === "new");
  const rest = list.filter((e) => e.status !== "new");

  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Design Enquiries</h1>
      <p className="text-sm text-muted mb-6">
        Dealers asking to see the <em>full</em> colour range of a design — the ones too big to list on the
        wholesale panel. Each request names the design and how they&apos;d like to see it: a video call, a
        store visit, or photos on WhatsApp. Reply, then mark it contacted so nothing slips.
      </p>

      {list.length === 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-card">
          <p className="text-sm text-muted">
            No enquiries yet. Mark a design as <span className="text-gold-dark font-medium">“More designs available”</span> on
            its product page (or a whole category from the Catalogue) and dealers will be able to request the full range here.
          </p>
        </div>
      )}

      {open.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Needs a reply ({open.length})</h2>
          <div className="space-y-3 mb-8">{open.map((e) => <DesignEnquiryCard key={e.id} e={e} />)}</div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Handled</h2>
          <div className="space-y-3">{rest.map((e) => <DesignEnquiryCard key={e.id} e={e} />)}</div>
        </>
      )}
    </main>
  );
}
