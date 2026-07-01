export const dynamic = "force-dynamic";
import { getApprovals } from "@/lib/supabase/queries";
import { decideApprovalAction } from "@/app/actions/approvals";

const rupee = (v: any) => (typeof v === "number" ? `₹${(v / 100).toLocaleString("en-IN")}` : v != null && v !== "" ? String(v) : "");
/** Turn a pending action's payload into a plain-English sentence (never raw JSON). */
function describeApproval(action: string, p: any): string {
  p = p ?? {};
  const who = p.by ? `${p.by} ` : "A staff member ";
  switch (action) {
    case "edit_price":
      return `${who}wants to change ${p.sku ?? "a product"}${p.field ? `'s ${p.field}` : "'s"} price${p.from != null ? ` from ${rupee(p.from)}` : ""}${p.to != null ? ` to ${rupee(p.to)}` : ""}.`;
    case "delete_purchase":
      return `${who}wants to delete purchase bill ${p.bill_no || p.purchase_id || ""} — stock from it will be reversed.`;
    default: {
      const entries = p && typeof p === "object" ? Object.entries(p) : [];
      return entries.length
        ? `${who}requested: ` + entries.map(([k, v]) => `${k.replace(/_/g, " ")} ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ")
        : String(p ?? "");
    }
  }
}

export default async function Approvals() {
  const approvals = await getApprovals();
  return (
    <main className="p-8 max-w-3xl">
      <h1 className="font-serif text-3xl text-diva-ink mb-1">Approvals</h1>
      <p className="text-sm text-diva-ink/60 mb-5">Sensitive staff actions wait here for your OTP. Nothing applies without it.</p>
      <div className="space-y-3">
        {approvals.length === 0 && <p className="text-sm text-diva-ink/50">No approval requests.</p>}
        {approvals.map((a: any) => (
          <div key={a.id} className="bg-white rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-diva-ink capitalize">{a.action.replace(/_/g, " ")}</p>
                <p className="text-xs text-diva-ink/60 mt-0.5">{describeApproval(a.action, a.payload)}</p>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs ${a.status === "pending" ? "bg-amber-100 text-amber-700" : a.status === "approved" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>{a.status}</span>
            </div>
            {a.status === "pending" && (
              <form action={decideApprovalAction} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="id" value={a.id} />
                <input name="otp" placeholder="Owner OTP" className="rounded border border-diva-ink/15 px-3 py-1.5 text-sm" />
                <button name="approve" value="1" className="px-4 py-1.5 rounded-full bg-green-600 text-white text-sm">Approve</button>
                <button name="approve" value="0" className="px-4 py-1.5 rounded-full bg-diva-ink/10 text-diva-ink text-sm">Reject</button>
                <span className="text-xs text-diva-ink/40">Demo OTP: 482913</span>
              </form>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
