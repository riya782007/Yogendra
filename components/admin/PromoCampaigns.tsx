"use client";
import { setPromoStatusAction, deletePromoAction } from "@/app/actions/promotions";

type Promo = {
  id: string; title: string | null; image_path: string | null; media_type?: string | null;
  placement?: string | null; status: string; headline?: string | null; discount_code?: string | null;
  starts_at?: string | null; ends_at?: string | null; show_retail?: boolean; show_wholesale?: boolean;
  category?: { name?: string } | null; created_at: string;
};

/** Computed lifecycle status for the badge — like a real campaign console. */
function statusOf(p: Promo): { label: string; cls: string } {
  const now = Date.now();
  if (p.status !== "published") return { label: "Paused", cls: "bg-sand/70 text-muted" };
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return { label: "Scheduled", cls: "bg-blue-100 text-blue-700" };
  if (p.ends_at && new Date(p.ends_at).getTime() < now) return { label: "Expired", cls: "bg-rose/10 text-rose" };
  return { label: "Live", cls: "bg-emerald-mist text-emerald-dark" };
}
const PLACEMENT: Record<string, string> = { hero: "Hero banner", popup: "Popup", strip: "Strip" };
const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : null);

/** Campaign list with Live / Scheduled / Expired / Paused status + one-tap pause/resume + delete. */
export function PromoCampaigns({ promos = [] }: { promos?: Promo[] }) {
  if (!promos.length) return <p className="text-sm text-muted">No campaigns yet — create your first above.</p>;
  return (
    <div className="space-y-2.5">
      {promos.map((p) => {
        const st = statusOf(p);
        const live = p.status === "published";
        const where = [p.show_retail && "Retail", p.show_wholesale && "Wholesale", p.category?.name].filter(Boolean).join(" · ");
        return (
          <div key={p.id} className="bg-white rounded-2xl border border-sand shadow-card p-3 flex items-center gap-3">
            <div className="h-14 w-20 rounded-lg overflow-hidden bg-cream shrink-0 grid place-items-center">
              {p.image_path
                ? (p.media_type === "video" ? <video src={p.image_path} className="w-full h-full object-cover" muted /> : <img src={p.image_path} alt="" className="w-full h-full object-cover" />)
                : <span className="text-[10px] text-muted px-1 text-center">{p.headline || "Strip"}</span>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium text-ink truncate">{p.title || p.headline || "Promotion"}</p>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-ink/5 text-ink/70">{PLACEMENT[p.placement ?? "hero"] ?? "Hero banner"}</span>
              </div>
              <p className="text-[11px] text-muted truncate">
                {where || "—"}
                {p.discount_code ? ` · code ${p.discount_code}` : ""}
                {fmt(p.starts_at) ? ` · from ${fmt(p.starts_at)}` : ""}
                {fmt(p.ends_at) ? ` · to ${fmt(p.ends_at)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <form action={setPromoStatusAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="status" value={live ? "archived" : "published"} />
                <button className={`text-xs px-2.5 py-1 rounded-full ${live ? "bg-gold/15 text-gold-dark hover:bg-gold/25" : "bg-emerald text-white hover:bg-emerald-dark"}`}>{live ? "Pause" : "Resume"}</button>
              </form>
              <form action={deletePromoAction} onSubmit={(e) => { if (!confirm("Delete this campaign permanently?")) e.preventDefault(); }}>
                <input type="hidden" name="id" value={p.id} />
                <button className="text-xs px-2.5 py-1 rounded-full border border-rose/40 text-rose hover:bg-rose/10">Delete</button>
              </form>
            </div>
          </div>
        );
      })}
    </div>
  );
}
