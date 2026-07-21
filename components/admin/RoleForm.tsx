"use client";
import { useState } from "react";
import { PERMISSION_GROUPS } from "@/lib/permissions";

type Action = (fd: FormData) => void | Promise<void>;

export function RoleForm({
  action, id, initialName = "", initialPerms = [], submitLabel = "Save role", compact = false,
}: {
  action: Action; id?: string; initialName?: string; initialPerms?: string[]; submitLabel?: string; compact?: boolean;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set(initialPerms));
  const toggle = (k: string) => setChecked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const toggleGroup = (keys: string[], on: boolean) => setChecked((s) => { const n = new Set(s); keys.forEach((k) => on ? n.add(k) : n.delete(k)); return n; });

  return (
    <form action={action} className="space-y-4">
      {id && <input type="hidden" name="id" value={id} />}
      {/* hidden inputs carry the checked state to the server action */}
      {[...checked].map((k) => <input key={k} type="hidden" name={`perm:${k}`} value="on" />)}

      <input name="name" defaultValue={initialName} placeholder="Role name (e.g. Counter Staff)" required
        className="w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald" />

      <div className={`grid gap-3 ${compact ? "" : "sm:grid-cols-2"}`}>
        {PERMISSION_GROUPS.map((g) => {
          const keys = g.perms.map((p) => p.key);
          const allOn = keys.every((k) => checked.has(k));
          return (
            <div key={g.key} className="rounded-xl border border-sand p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/70">{g.label}</p>
                <button type="button" onClick={() => toggleGroup(keys, !allOn)} className="text-[11px] text-emerald hover:underline">{allOn ? "Clear" : "All"}</button>
              </div>
              <div className="space-y-1.5">
                {g.perms.map((p) => (
                  <label key={p.key} className="flex items-start gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={checked.has(p.key)} onChange={() => toggle(p.key)} className="accent-emerald mt-0.5" />
                    <span><span className="text-ink">{p.label}</span>{p.desc && <span className="text-muted text-xs"> · {p.desc}</span>}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn-primary px-6 py-2.5 text-sm font-medium">{submitLabel}</button>
    </form>
  );
}
