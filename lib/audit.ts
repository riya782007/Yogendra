import "server-only";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * lib/audit.ts — the single place every owner-visible action is recorded.
 *
 * Writes a row to `audit_log` (id, at, actor, action, ref, detail) so the
 * Notifications → Activity feed can show "Deleted Rajwadi Necklace (BD1004)",
 * "Hidden BD1010 from store", "Price changed for BD1007", etc.
 *
 * Best-effort by design: logging must NEVER block or fail the real action, so
 * every call is wrapped and swallows its own errors. Fire-and-forget friendly.
 */
export async function logActivity(entry: {
  action: string;
  ref?: string | null;
  detail?: string | null;
  actor?: string | null;
}): Promise<void> {
  try {
    const sb = supabaseServer();
    await sb.from("audit_log").insert({
      actor: entry.actor ?? "owner",
      action: entry.action,
      ref: entry.ref ?? null,
      detail: entry.detail ?? null,
    });
  } catch {
    /* never let an audit write break the operation it's recording */
  }
}

/** Human-friendly label + icon hint for an action code, used by the Activity feed UI. */
export const ACTIVITY_META: Record<string, { label: string; tone: string; icon: string }> = {
  product_created: { label: "Product added", tone: "emerald", icon: "＋" },
  product_deleted: { label: "Product deleted", tone: "rose", icon: "🗑" },
  product_hidden: { label: "Hidden from store", tone: "gold", icon: "🙈" },
  product_shown: { label: "Shown on store", tone: "emerald", icon: "👁" },
  product_wholesale_only: { label: "Wholesale-only changed", tone: "wine", icon: "🏷" },
  price_changed: { label: "Price changed", tone: "gold", icon: "₹" },
  category_created: { label: "Category added", tone: "emerald", icon: "＋" },
  category_deleted: { label: "Category deleted", tone: "rose", icon: "🗑" },
  subcategory_created: { label: "Subcategory added", tone: "emerald", icon: "＋" },
  subcategory_deleted: { label: "Subcategory deleted", tone: "rose", icon: "🗑" },
  product_submitted: { label: "Product submitted", tone: "gold", icon: "📥" },
  submission_approved: { label: "Submission approved", tone: "emerald", icon: "✓" },
  submission_rejected: { label: "Submission rejected", tone: "rose", icon: "✕" },
  // approvals.ts / reorder.ts already write these:
  otp_rejected: { label: "OTP rejected", tone: "rose", icon: "✕" },
  approved: { label: "Approved", tone: "emerald", icon: "✓" },
  rejected: { label: "Rejected", tone: "rose", icon: "✕" },
  applied: { label: "Applied", tone: "emerald", icon: "✓" },
  reorder_approved: { label: "Reorder approved", tone: "emerald", icon: "✓" },
};

export const ACTIVITY_TONE: Record<string, string> = {
  emerald: "bg-emerald-mist text-emerald-dark",
  rose: "bg-rose/10 text-rose",
  gold: "bg-gold/15 text-gold-dark",
  wine: "bg-wine/10 text-wine",
  ink: "bg-ink/10 text-ink",
};
