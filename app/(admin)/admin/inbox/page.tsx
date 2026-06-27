export const dynamic = "force-dynamic";
import Link from "next/link";
import { getNotifications, getAssignmentsRegistry, getActivityLog } from "@/lib/supabase/queries";
import { ACTIVITY_META, ACTIVITY_TONE } from "@/lib/audit";

export const metadata = { title: "Owner Console · Notifications" };
const ago = (d: string) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export default async function Inbox() {
  const [notifs, registry, activity] = await Promise.all([getNotifications(), getAssignmentsRegistry(), getActivityLog()]);
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Notifications &amp; Activity</h1>
      <p className="text-sm text-muted mb-6">Every human-required step pings the assigned person, and every change you make to the catalogue is logged below — nothing passes silently.</p>

      {/* Recent activity — the running log of catalogue actions (add / delete / hide / price…) */}
      <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-ink">Recent activity</h2>
          <span className="text-xs text-muted">{activity.length} recent action{activity.length === 1 ? "" : "s"}</span>
        </div>
        {activity.length === 0 ? (
          <p className="text-sm text-muted">No activity recorded yet. Add, hide, re-price or delete a product and it shows up here instantly.</p>
        ) : (
          <ul className="divide-y divide-sand/50">
            {activity.map((a: any) => {
              const meta = ACTIVITY_META[a.action] ?? { label: String(a.action).replace(/_/g, " "), tone: "ink", icon: "•" };
              return (
                <li key={a.id} className="flex items-start gap-3 py-2.5">
                  <span className={`mt-0.5 h-7 w-7 shrink-0 grid place-items-center rounded-full text-sm ${ACTIVITY_TONE[meta.tone] ?? ACTIVITY_TONE.ink}`}>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-ink">
                      <span className="font-medium">{meta.label}</span>
                      {a.detail ? <span className="text-muted"> — {a.detail}</span> : a.ref ? <span className="text-muted"> — {a.ref}</span> : null}
                    </p>
                    <p className="text-xs text-muted">{a.actor ?? "system"} · {ago(a.at)}</p>
                  </div>
                  {a.ref && /^[A-Za-z]{1,4}\d/.test(String(a.ref)) && a.action !== "product_deleted" && (
                    <Link href={`/admin/catalogue/${a.ref}`} className="text-xs text-emerald nav-link whitespace-nowrap">Open →</Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
        <h2 className="font-medium text-ink mb-3">Inbox</h2>
        <div className="space-y-2">
          {notifs.length === 0 && <p className="text-sm text-muted">No notifications.</p>}
          {notifs.map((n: any) => (
            <div key={n.id} className="flex items-center gap-3 border-b border-sand/50 py-2.5">
              <span className={`h-2 w-2 rounded-full ${n.status === "sent" ? "bg-gold" : n.status === "acked" ? "bg-emerald" : "bg-rose"}`} />
              <div className="flex-1">
                <p className="text-sm text-ink">{n.subject}</p>
                <p className="text-xs text-muted">to {n.contact?.name} · {n.channel} · {ago(n.sent_at)}</p>
              </div>
              {n.deep_link && <Link href={n.deep_link} className="text-xs text-emerald nav-link">Open →</Link>}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-card">
        <h2 className="font-medium text-ink mb-3">Who owns what (assignment registry)</h2>
        <table className="w-full text-sm">
          <thead className="text-muted text-left"><tr><th className="py-1">Responsibility</th><th className="py-1">Owner</th><th className="py-1">Backup</th><th className="py-1">Channel</th><th className="py-1">SLA</th></tr></thead>
          <tbody>
            {registry.map((a: any) => (
              <tr key={a.id} className="border-t border-sand/50">
                <td className="py-2 capitalize text-ink">{String(a.responsibility).replace(/_/g, " ")}</td>
                <td className="py-2">{a.assignee?.name ?? "—"}</td>
                <td className="py-2 text-muted">{a.backup?.name ?? "—"}</td>
                <td className="py-2 capitalize">{a.channel}</td>
                <td className="py-2 text-muted">{a.sla_minutes}m</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
