"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adjustStockJsonAction, moveStockAction, skuStockAction } from "@/app/actions/stock";
import { QtyField } from "@/components/admin/QtyField";
import { SkuInput } from "@/components/admin/SkuInput";

const SOURCES = [
  "Returned from cart (in-store)",
  "Customer cancelled",
  "Found / recount",
  "Sample returned",
  "Damaged — removed",
  "Correction",
  "Other",
];

const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
type Msg = { text: string; ok: boolean } | null;

/**
 * Inventory page stock tools.
 *  · ± Adjust stock — add / remove (needs inventory.add / inventory.remove). Now replies with what
 *    happened ("WT1050: +3 → now 7 pcs") instead of silently closing.
 *  · ⇄ Move stock — owner, Oct 2026: when pieces sit on the wrong SKU (WT1052 has 3 but they are really
 *    WT1050) move them in one step. Total stock never changes, so staff with only "Move stock between
 *    SKUs" can fix it without getting add/remove rights.
 * Every change lands in the Adjustment record below and in Stock Movement History.
 */
export function StockAdjust({ canAdjust = true, canMove = true }: { canAdjust?: boolean; canMove?: boolean }) {
  const [open, setOpen] = useState<"" | "adjust" | "move">("");
  if (!canAdjust && !canMove) return null;
  const btn = (k: "adjust" | "move", label: string) => (
    <button type="button" onClick={() => setOpen((o) => (o === k ? "" : k))}
      className={`px-4 py-2 rounded-xl border text-sm transition-colors ${open === k ? "bg-emerald text-white border-emerald" : "border-emerald text-emerald hover:bg-emerald-mist"}`}>
      {open === k ? "× Close" : label}
    </button>
  );
  return (
    <div className="mb-4">
      <div className="flex flex-wrap gap-2">
        {canAdjust && btn("adjust", "± Adjust stock")}
        {canMove && btn("move", "⇄ Move stock to another SKU")}
      </div>
      {open === "adjust" && <AdjustForm />}
      {open === "move" && <MoveForm />}
    </div>
  );
}

function AdjustForm() {
  const router = useRouter();
  const [sku, setSku] = useState("");
  const [sign, setSign] = useState<1 | -1>(1);
  const [n, setN] = useState(1);
  const [source, setSource] = useState(SOURCES[0]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  async function apply() {
    setBusy(true); setMsg(null);
    const fd = new FormData();
    fd.set("sku", sku); fd.set("delta", String(sign * Math.max(1, Math.abs(n)))); fd.set("source", source); fd.set("reason", reason);
    try {
      const r = await adjustStockJsonAction(fd);
      if (!r.ok) setMsg({ text: r.error ?? "Couldn't adjust.", ok: false });
      else {
        setMsg({ text: `✓ ${r.sku}: ${r.applied! > 0 ? "+" : ""}${r.applied} → now ${r.nowQty} pcs. Saved in the record below.`, ok: true });
        setSku(""); setN(1); setReason("");
        router.refresh();
      }
    } catch { setMsg({ text: "Couldn't reach the server — try again.", ok: false }); }
    setBusy(false);
  }

  return (
    <div className="mt-3 bg-white rounded-2xl p-4 shadow-card border border-sand">
      <div className="grid sm:grid-cols-5 gap-3 items-end">
        <label className="text-xs text-muted">SKU<div className="mt-1"><SkuInput value={sku} onChange={setSku} placeholder="Type SKU or name…" className={`${fld} w-full font-mono`} /></div></label>
        <div className="text-xs text-muted">
          Direction
          <div className="flex gap-1 mt-1">
            <button type="button" onClick={() => setSign(1)} className={`px-3 py-2 rounded-xl text-sm flex-1 ${sign === 1 ? "bg-emerald-mist text-emerald border border-emerald" : "border border-sand text-muted"}`}>Add</button>
            <button type="button" onClick={() => setSign(-1)} className={`px-3 py-2 rounded-xl text-sm flex-1 ${sign === -1 ? "bg-rose/10 text-rose border border-rose" : "border border-sand text-muted"}`}>Remove</button>
          </div>
        </div>
        <label className="text-xs text-muted">Quantity<QtyField value={n} onChange={setN} className={`${fld} w-full mt-1`} /></label>
        <label className="text-xs text-muted">Source / reason
          <select value={source} onChange={(e) => setSource(e.target.value)} className={`${fld} w-full mt-1`}>{SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <button type="button" onClick={apply} disabled={busy || !sku.trim()} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Saving…" : "Apply"}</button>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional note (e.g. customer short on cash)" className={`${fld} sm:col-span-5`} />
      </div>
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
    </div>
  );
}

function useSkuStock(sku: string) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof skuStockAction>> | undefined>(undefined);
  useEffect(() => {
    const s = sku.trim();
    if (s.length < 2) { setInfo(undefined); return; }
    let live = true;
    const t = setTimeout(async () => { try { const r = await skuStockAction(s); if (live) setInfo(r); } catch { /* ignore */ } }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [sku]);
  return info;
}

function StockHint({ info }: { info: Awaited<ReturnType<typeof skuStockAction>> | undefined }) {
  if (info === undefined) return null;
  if (info === null) return <span className="block text-[11px] text-rose mt-1">SKU not found</span>;
  if ((info.colours ?? 0) > 1) return <span className="block text-[11px] text-gold-dark mt-1">{info.name} has {info.colours} colours — pick the colour SKU</span>;
  return <span className="block text-[11px] text-muted mt-1">{info.name} · <b className="text-ink">{info.qty}</b> pcs now</span>;
}

function MoveForm() {
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [n, setN] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const fromInfo = useSkuStock(from);
  const toInfo = useSkuStock(to);

  async function move() {
    setBusy(true); setMsg(null);
    try {
      const r = await moveStockAction({ from, to, qty: n, note });
      if (!r.ok) setMsg({ text: r.error ?? "Couldn't move.", ok: false });
      else {
        setMsg({ text: `✓ Moved ${r.moved} pcs: ${r.from_sku} → ${r.to_sku}. Now ${r.from_sku} has ${r.from_qty}, ${r.to_sku} has ${r.to_qty}.`, ok: true });
        setFrom(""); setTo(""); setN(1); setNote("");
        router.refresh();
      }
    } catch { setMsg({ text: "Couldn't reach the server — try again.", ok: false }); }
    setBusy(false);
  }

  return (
    <div className="mt-3 bg-white rounded-2xl p-4 shadow-card border border-sand">
      <p className="text-xs text-muted mb-3">Stock is sitting on the wrong SKU? Move it in one step — e.g. <b>WT1052</b> shows 3 pcs but they are really <b>WT1050</b>. Total stock stays the same; both SKUs are updated together and the move is recorded.</p>
      <div className="grid sm:grid-cols-[1fr_auto_1fr_8rem_auto] gap-3 items-start">
        <label className="text-xs text-muted">Move FROM (wrong SKU)
          <div className="mt-1"><SkuInput value={from} onChange={setFrom} placeholder="e.g. WT1052" className={`${fld} w-full font-mono`} /></div>
          <StockHint info={fromInfo} />
        </label>
        <span className="hidden sm:block pt-7 text-xl text-muted">→</span>
        <label className="text-xs text-muted">Move TO (correct SKU)
          <div className="mt-1"><SkuInput value={to} onChange={setTo} placeholder="e.g. WT1050" className={`${fld} w-full font-mono`} /></div>
          <StockHint info={toInfo} />
        </label>
        <label className="text-xs text-muted">Pieces<QtyField value={n} onChange={setN} className={`${fld} w-full mt-1`} /></label>
        <button type="button" onClick={move} disabled={busy || !from.trim() || !to.trim()} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-60 sm:mt-5">{busy ? "Moving…" : "Move stock"}</button>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (e.g. tag printed wrong at purchase)" className={`${fld} w-full mt-3`} />
      {fromInfo && fromInfo.qty < n && (fromInfo.colours ?? 0) <= 1 && <p className="mt-2 text-xs text-rose">{fromInfo.sku} has only {fromInfo.qty} pcs — you can move at most {fromInfo.qty}.</p>}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
    </div>
  );
}
