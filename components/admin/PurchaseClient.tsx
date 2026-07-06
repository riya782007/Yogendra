"use client";
import { useState } from "react";
import { formatPaise } from "@/lib/pricing";
import { recordPurchaseAction } from "@/app/actions/purchases";

type Sup = { id: string; name: string; city: string | null };
type Variant = { id: string; sku: string; label: string };
type Prod = { id: string; name: string; sku: string; variants?: Variant[] };
type Line = { supplierSku: string; mappedProductId: string; mappedName: string; variantId: string; qty: string; cost: string };

type LastCosts = { byProduct: Record<string, number>; byVariant: Record<string, number> };

export function PurchaseClient({ suppliers, products, lastCosts }: { suppliers: Sup[]; products: Prod[]; lastCosts?: LastCosts }) {
  const [supplierId, setSupplierId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [lines, setLines] = useState<Line[]>([{ supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDup, setConfirmDup] = useState(false);
  // How this purchase was paid — a SPLIT across methods. Enter any amount against cash / upi / bank
  // (one, several, or none). Whatever is left unpaid stays owed to the supplier (credit).
  const [pay, setPay] = useState<{ cash: string; upi: string; bank: string }>({ cash: "", upi: "", bank: "" });

  const input = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
  const set = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  // Expand one mapped parent into one line per colour (same supplier code & cost) so a 15-colour
  // design can be entered in seconds — just fill the qty for each colour.
  const expandColours = (i: number) => setLines((prev) => {
    const line = prev[i];
    const vs = products.find((p) => p.id === line.mappedProductId)?.variants ?? [];
    if (!vs.length) return prev;
    const rows = vs.map((v) => ({ ...line, variantId: v.id, qty: "" }));
    return [...prev.slice(0, i), ...rows, ...prev.slice(i + 1)];
  });
  const suggest = (q: string) => q.trim() ? products.filter((p) => (p.name + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  // Split-payment maths (rupees). paidNow = sum of all methods; the rest stays on credit.
  const METHODS = [["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"]] as const;
  const paidNow = (Number(pay.cash) || 0) + (Number(pay.upi) || 0) + (Number(pay.bank) || 0);
  const credit = Math.max(0, total - paidNow);
  const over = paidNow > total && total > 0;
  /** Fill one method with whatever is still unpaid (so "Bank: fill remaining" pays the balance). */
  const fillRemaining = (m: "cash" | "upi" | "bank") => setPay((s) => {
    const others = (["cash", "upi", "bank"] as const).filter((k) => k !== m).reduce((n, k) => n + (Number(s[k]) || 0), 0);
    const rem = Math.max(0, total - others);
    return { ...s, [m]: rem ? String(rem) : "" };
  });

  async function submit(force = false) {
    // A mapped product that HAS colours must be bought as a specific colour — never the parent.
    const missing = lines.find((l) => {
      if (!l.mappedProductId || !(Number(l.qty) > 0)) return false;
      const hasVariants = (products.find((p) => p.id === l.mappedProductId)?.variants ?? []).length > 0;
      return hasVariants && !l.variantId;
    });
    if (missing) { setMsg(`✕ Pick a colour for "${missing.mappedName}" — products with colours are bought per colour, not as the whole product.`); return; }
    if (over) { setMsg(`✕ Paid ${formatPaise(paidNow * 100)} is more than the bill total ${formatPaise(total * 100)} — reduce a method.`); return; }
    setBusy(true); setMsg(""); if (!force) setConfirmDup(false);
    // Split payment: send one leg per method that has an amount. The rest is left as credit.
    const payments = METHODS
      .map(([m]) => ({ mode: m, amountRupees: Number(pay[m]) || 0 }))
      .filter((p) => p.amountRupees > 0);
    const res = await recordPurchaseAction({
      supplierId, billNo, force,
      items: lines.map((l) => ({ supplierSku: l.supplierSku, mappedProductId: l.mappedProductId, variantId: l.variantId, qty: Number(l.qty) || 0, unitCostRupees: Number(l.cost) || 0 })),
      payments,
    });
    setBusy(false);
    if (res.ok) {
      const owed = Math.max(0, total - paidNow);
      setMsg(`✓ Purchase recorded (${formatPaise(res.total ?? 0)})${owed > 0 ? ` — ${formatPaise(owed * 100)} on credit to supplier` : " — paid in full"}. Stock updated.`);
      setLines([{ supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }]); setBillNo(""); setPay({ cash: "", upi: "", bank: "" }); setConfirmDup(false);
    }
    else { setMsg(`✕ ${res.error}`); setConfirmDup(!!res.duplicateBillNo); }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <select className={input} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Select supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
        </select>
        <input className={input} placeholder="Supplier bill no." value={billNo} onChange={(e) => setBillNo(e.target.value)} />
      </div>

      <p className="text-xs text-muted mb-2">Type the supplier&apos;s item name/code — we suggest your internal SKU. Map it, or leave unmapped to skip the stock update.</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-5 relative">
              <input className={input + " w-full"} placeholder="Supplier item / code" value={l.supplierSku}
                onChange={(e) => { set(i, { supplierSku: e.target.value }); setOpenIdx(i); }} onFocus={() => setOpenIdx(i)} />
              {l.mappedName ? (
                <>
                  <p className="text-[11px] text-emerald-dark mt-0.5">→ {l.mappedName} <button onClick={() => set(i, { mappedProductId: "", mappedName: "", variantId: "" })} className="text-muted underline ml-1">change</button></p>
                  {(() => {
                    const vs = products.find((p) => p.id === l.mappedProductId)?.variants ?? [];
                    if (!vs.length) return null;
                    // Products with colours are only ever bought as a specific colour — the parent
                    // SKU isn't a real stockable item. So force a colour choice (no "whole product").
                    return (
                      <div className="mt-1 flex items-center gap-1.5">
                        <select className={`${input} flex-1 text-xs ${l.variantId ? "" : "border-rose text-rose"}`} value={l.variantId} onChange={(e) => set(i, { variantId: e.target.value })}>
                          <option value="" disabled>Choose colour / variant…</option>
                          {vs.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.sku}</option>)}
                        </select>
                        {vs.length > 1 && (
                          <button type="button" onClick={() => expandColours(i)}
                            className="shrink-0 text-[11px] px-2 py-1.5 rounded-lg bg-emerald-mist text-emerald-dark hover:bg-emerald/15"
                            title="Add a line for every colour of this design">+ all {vs.length} colours</button>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : openIdx === i && suggest(l.supplierSku).length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
                  {suggest(l.supplierSku).map((p) => (
                    <button key={p.id} onClick={() => { set(i, { mappedProductId: p.id, mappedName: `${p.name} (${p.sku})`, variantId: "" }); setOpenIdx(null); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-mist">{p.name} <span className="text-muted">· {p.sku}</span></button>
                  ))}
                </div>
              )}
            </div>
            <input className={input + " col-span-2"} placeholder="Qty" inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <div className="col-span-3">
              <input className={input + " w-full"} placeholder="Unit cost ₹" inputMode="numeric" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
              {(() => {
                const last = l.variantId ? lastCosts?.byVariant?.[l.variantId] : (l.mappedProductId ? lastCosts?.byProduct?.[l.mappedProductId] : undefined);
                if (!last) return null;
                const r = Math.round(last / 100);
                return <button type="button" onClick={() => set(i, { cost: String(r) })} className="block text-[10px] text-emerald-dark mt-0.5 hover:underline" title="Use last purchase price">last ₹{r} · use</button>;
              })()}
            </div>
            <div className="col-span-2 flex items-center justify-end gap-2 pt-2 text-sm">
              <span className="sensitive">{formatPaise((Number(l.qty) || 0) * (Number(l.cost) || 0) * 100)}</span>
              <button type="button" onClick={() => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))}
                title="Remove this line" className="text-muted hover:text-rose leading-none shrink-0">✕</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setLines((p) => [...p, { supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }])} className="text-sm text-emerald nav-link mt-3">+ Add line</button>

      {/* Payment — SPLIT across methods. Enter any amount against cash / upi / bank (one, several,
          or none). Whatever is left unpaid is registered as credit owed to the supplier. */}
      <div className="mt-5 border-t border-sand pt-4">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="text-lg font-semibold text-ink">Total: <span className="sensitive">{formatPaise(total * 100)}</span></span>
          <span className="text-[11px] text-muted ml-auto">Split the payment across methods — anything left over stays on credit.</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {METHODS.map(([m, label]) => (
            <div key={m} className="rounded-xl border border-sand p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink">{label}</span>
                <button type="button" onClick={() => fillRemaining(m)} className="text-[10px] text-emerald-dark hover:underline" title="Pay the remaining balance with this method">fill remaining</button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-muted">₹</span>
                <input value={pay[m]} onChange={(e) => setPay((s) => ({ ...s, [m]: e.target.value }))} inputMode="decimal" placeholder="0" className={`${input} w-full`} />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <p className="text-[11px]">
            {over ? (
              <span className="text-rose">Paid {formatPaise(paidNow * 100)} exceeds the total — reduce a method.</span>
            ) : paidNow === 0 ? (
              <span className="text-gold-dark">Nothing paid now — the full {formatPaise(total * 100)} will be owed to this supplier (credit). Record payments later from the supplier page.</span>
            ) : credit > 0 ? (
              <span className="text-muted">Paid {formatPaise(paidNow * 100)} now · <b className="text-gold-dark">{formatPaise(credit * 100)} on credit</b></span>
            ) : (
              <span className="text-emerald-dark">Paid in full ✓</span>
            )}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            {confirmDup && (
              <button onClick={() => submit(true)} disabled={busy || over} className="px-4 py-2.5 rounded-xl border border-rose text-rose text-sm font-medium hover:bg-rose/10 disabled:opacity-50">Record anyway</button>
            )}
            <button onClick={() => submit(false)} disabled={busy || over} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Recording…" : "Record purchase"}</button>
          </div>
        </div>
      </div>
      {msg && <p className={`text-sm mt-2 ${confirmDup ? "text-rose" : "text-ink"}`}>{msg}</p>}
    </div>
  );
}
