export const dynamic = "force-dynamic";
import Link from "next/link";
import { getNotifications, getAssignmentsRegistry } from "@/lib/supabase/queries";

export const metadata = { title: "Owner Console · Notifications" };
const ago = (d: string) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export default async function Inbox() {
  const [notifs, registry] = await Promise.all([getNotifications(), getAssignmentsRegistry()]);
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Notifications</h1>
      <p className="text-sm text-muted mb-6">Every human-required step lands here and pings the assigned person — nothing passes silently.</p>

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
