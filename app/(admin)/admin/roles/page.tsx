export const dynamic = "force-dynamic";
import { getRoles } from "@/lib/supabase/queries";
import { createRoleAction, PERMISSIONS } from "@/app/actions/rbac";

export const metadata = { title: "Owner Console · Roles & Permissions" };
const label = (p: string) => p.replace(/_/g, " ");

export default async function Roles() {
  const roles = await getRoles();
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Roles &amp; Permissions</h1>
      <p className="text-sm text-muted mb-6">Discord-style custom roles. Create a role, tick exactly what it can do, then assign staff to it.</p>

      <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
        <h2 className="font-medium text-ink mb-3">Create a role</h2>
        <form action={createRoleAction} className="space-y-4">
          <input name="name" placeholder="Role name (e.g. Counter Staff)" className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PERMISSIONS.map((p) => (
              <label key={p} className="flex items-center gap-2 text-sm capitalize bg-cream/60 rounded-xl px-3 py-2 cursor-pointer hover:bg-emerald-mist transition-colors">
                <input type="checkbox" name={`perm_${p}`} className="accent-emerald" /> {label(p)}
              </label>
            ))}
          </div>
          <button className="btn-primary px-6 py-2.5 text-sm font-medium">Create role</button>
        </form>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {roles.map((r: any) => (
          <div key={r.id} className="bg-white rounded-2xl p-5 shadow-card">
            <p className="font-medium text-ink mb-2">{r.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {(r.permissions ?? []).length === 0 && <span className="text-xs text-muted">No permissions</span>}
              {(r.permissions ?? []).map((p: string) => (
                <span key={p} className="text-[11px] capitalize px-2 py-1 rounded-full bg-emerald-mist text-emerald-dark">{label(p)}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
