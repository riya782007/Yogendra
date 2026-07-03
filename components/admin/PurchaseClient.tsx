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
  // How this purchase was paid. "credit" = nothing paid now → the full bill stays owed to the
  // supplier (registered on their ledger). Otherwise the paid amount is recorded against the supplier.
  const [payMode, setPayMode] = useState<"cash" | "upi" | "bank" | "credit">("credit");
  const [paidStr, setPaidStr] = useState(""); // ₹ paid now; blank = full when a mode is chosen

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

  async function submit(force = false) {
    // A mapped product that HAS colours must be bought as a specific colour — never the parent.
    const missing = lines.find((l) => {
      if (!l.mappedProductId || !(Number(l.qty) > 0)) return false;
      const hasVariants = (products.find((p) => p.id === l.mappedProductId)?.variants ?? []).length > 0;
      return hasVariants && !l.variantId;
    });
    if (missing) { setMsg(`✕ Pick a colour for "${missing.mappedName}" — products with colours are bought per colour, not as the whole product.`); return; }
    setBusy(true); setMsg(""); if (!force) setConfirmDup(false);
    // Paid now: 0 for credit; else the typed amount, defaulting to the full bill when left blank.
    const amountPaidRupees = payMode === "credit" ? 0 : (paidStr.trim() !== "" ? Number(paidStr) || 0 : total);
    const res = await recordPurchaseAction({
      supplierId, billNo, force,
      items: lines.map((l) => ({ supplierSku: l.supplierSku, mappedProductId: l.mappedProductId, variantId: l.variantId, qty: Number(l.qty) || 0, unitCostRupees: Number(l.cost) || 0 })),
      paymentMode: payMode, amountPaidRupees,
    });
    setBusy(false);
    if (res.ok) {
      const owed = Math.max(0, total - amountPaidRupees);
      setMsg(`✓ Purchase recorded (${formatPaise(res.total ?? 0)})${payMode === "credit" || owed > 0 ? ` — ${formatPaise(owed * 100)} on credit to supplier` : " — paid in full"}. Stock updated.`);
      setLines([{ supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }]); setBillNo(""); setPaidStr(""); setPayMode("credit"); setConfirmDup(false);
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
            <div className="col-span-2 text-sm text-right pt-2">{formatPaise((Number(l.qty) || 0) * (Number(l.cost) || 0) * 100)}</div>
          </div>
        ))}
      </div>
      <button onClick={() => setLines((p) => [...p, { supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }])} className="text-sm text-emerald nav-link mt-3">+ Add line</button>

      {/* Payment — how this purchase was paid. Credit leaves the amount owed on the supplier ledger. */}
      <div className="mt-5 border-t border-sand pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-lg font-semibold text-ink">Total: {formatPaise(total * 100)}</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[11px] text-muted mr-1">Payment</span>
            {([["credit", "Credit"], ["cash", "Cash"], ["upi", "UPI"], ["bank", "Bank"]] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => setPayMode(v)}
                className={`px-3 py-1.5 rounded-full text-xs transition-colors ${payMode === v ? (v === "credit" ? "bg-gold text-ink" : "bg-ink text-white") : "bg-white border border-sand text-muted hover:border-emerald"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 mt-2">
          {payMode === "credit" ? (
            <p className="text-[11px] text-gold-dark">The full {formatPaise(total * 100)} will be registered as owed to this supplier (payable). Record payments later from the supplier page.</p>
          ) : (
            <label className="text-[11px] text-muted flex items-center gap-1.5">
              Paid now ₹
              <input value={paidStr} onChange={(e) => setPaidStr(e.target.value)} inputMode="decimal" placeholder={String(total)} className={`${input} w-28`} />
              <span className="text-muted">{paidStr.trim() !== "" && Number(paidStr) < total ? `· ${formatPaise((total - (Number(paidStr) || 0)) * 100)} on credit` : "· paid in full"}</span>
            </label>
          )}
          <div className="flex items-center gap-2 ml-auto">
            {confirmDup && (
              <button onClick={() => submit(true)} disabled={busy} className="px-4 py-2.5 rounded-xl border border-rose text-rose text-sm font-medium hover:bg-rose/10 disabled:opacity-50">Record anyway</button>
            )}
            <button onClick={() => submit(false)} disabled={busy} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Recording…" : "Record purchase"}</button>
          </div>
        </div>
      </div>
      {msg && <p className={`text-sm mt-2 ${confirmDup ? "text-rose" : "text-ink"}`}>{msg}</p>}
    </div>
  );
}
