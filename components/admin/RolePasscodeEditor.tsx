"use client";
import { useState, useTransition } from "react";
import { setRolePasscodeAction } from "@/app/actions/rbac";

/** Lets the owner type an easy passcode for a role. Staff can type it in any case (login upper-cases it). */
export function RolePasscodeEditor({ id }: { id: string }) {
  const [value, setValue] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await setRolePasscodeAction(id, value);
      if (r.ok) { setValue(""); setMsg({ ok: true, text: "Passcode updated." }); }
      else setMsg({ ok: false, text: r.error ?? "Could not save." });
    });
  }

  return (
    <form onSubmit={save} className="mt-4 rounded-xl border border-sand p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink/70 mb-2">Set your own passcode</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={value} onChange={(e) => setValue(e.target.value)} maxLength={20} autoComplete="off"
          placeholder="e.g. POOJA123 (4–20 characters)"
          className="flex-1 min-w-[180px] rounded-xl border border-sand px-4 py-2 text-sm bg-white outline-none focus:border-emerald font-mono tracking-wider"
        />
        <button disabled={pending || value.trim().length < 4} className="btn-primary px-5 py-2 text-sm font-medium disabled:opacity-50">
          {pending ? "Saving…" : "Save passcode"}
        </button>
      </div>
      <p className="text-[11px] text-muted mt-1.5">Letters, numbers and @ # _ . - allowed. Capital/small letters don't matter when logging in. Must be different from other roles and your owner passcode.</p>
      {msg && <p className={`text-xs mt-1.5 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
    </form>
  );
}
