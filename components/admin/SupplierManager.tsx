"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupplierAction, deleteSupplierAction } from "@/app/actions/purchases";

type Sup = { id: string; name: string; city: string | null };

/** Add / delete suppliers. The form CLEARS and shows "Saved ✓" after each save (so nobody clicks
 *  twice and makes duplicates), the button is disabled while saving, and the server also de-dupes by
 *  name as a safety net. Delete asks for confirmation and refuses if the supplier has purchases. */
export function SupplierManager({ suppliers }: { suppliers: Sup[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const inp = "w-full rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

  async function add() {
    const nm = name.trim();
    if (!nm) { setMsg({ text: "Enter a supplier name.", ok: false }); return; }
    setBusy(true); setMsg(null);
    const r = await createSupplierAction({ name: nm, city: city.trim() });
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't save.", ok: false }); return; }
    setName(""); setCity("");
    setMsg({ text: r.duplicate ? `"${nm}" already exists — not added again ✓` : `Saved "${nm}" ✓`, ok: true });
    router.refresh();
  }

  async function del(id: string) {
    setBusy(true); setMsg(null);
    const r = await deleteSupplierAction({ supplierId: id });
    setBusy(false); setConfirmId(null);
    if (!r.ok) { setMsg({ text: r.error ?? "Couldn't delete.", ok: false }); return; }
    setMsg({ text: "Supplier deleted ✓", ok: true });
    router.refresh();
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-card">
      <h2 className="font-medium text-ink mb-3">Add supplier</h2>
      <div className="space-y-2">
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Supplier name" className={inp} />
        <input value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="City (e.g. Mumbai)" className={inp} />
        <button onClick={add} disabled={busy || !name.trim()} className="btn-primary px-5 py-2 text-sm font-medium disabled:opacity-50">{busy ? "Saving…" : "Add"}</button>
      </div>
      {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}

      <div className="mt-4 text-sm">
        {suppliers.map((s) => (
          <div key={s.id} className="flex items-center justify-between border-b border-sand/50 py-1.5 gap-2">
            <span className="text-ink truncate">{s.name} {s.city && <span className="text-muted text-xs">· {s.city}</span>}</span>
            {confirmId === s.id ? (
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-[11px] text-rose">Delete?</span>
                <button onClick={() => del(s.id)} disabled={busy} className="text-[11px] px-2 py-0.5 rounded-full bg-rose text-white disabled:opacity-50">Yes</button>
                <button onClick={() => setConfirmId(null)} className="text-[11px] px-2 py-0.5 rounded-full border border-sand text-muted">No</button>
              </span>
            ) : (
              <button onClick={() => setConfirmId(s.id)} className="text-[11px] text-muted hover:text-rose shrink-0" title="Delete supplier">✕ delete</button>
            )}
          </div>
        ))}
        {suppliers.length === 0 && <p className="text-muted text-xs py-2">No suppliers yet.</p>}
      </div>
    </div>
  );
}
