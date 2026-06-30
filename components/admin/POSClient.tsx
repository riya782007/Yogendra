"use client";
import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { posSaleAction } from "@/app/actions/orders";
import { QtyField } from "@/components/admin/QtyField";

type P = { sku: string; name: string; price: number; wholesale: number; mrp: number; category: string; qty: number };
type Line = { sku: string; name: string; price: number; wholesale: number; mrp: number; qty: number; stock: number; override: string; disc: string };
type Cust = { id: string; name: string; phone: string; type: string; gstin: string };

// Owner shorthand for the two price lists (kept private from onlookers): R = retail, W = wholesale.
// Per the client: the tier is NOT chosen manually — it comes from the selected customer.
const TIER_LABEL: Record<string, string> = { retail: "R", wholesale: "W" };

type Method = { id: string; name: string; kind: string };
type PayLine = { methodId: string; amount: string };

export function POSClient({ products, customers = [], methods = [] }: { products: P[]; customers?: Cust[]; methods?: Method[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [cust, setCust] = useState({ name: "", phone: "" });
  const [custType, setCustType] = useState<"retail" | "wholesale">("retail"); // from the customer, not a manual toggle
  const [billType, setBillType] = useState<"gst" | "cash">("gst");
  const [gstin, setGstin] = useState("");
  const [addr, setAddr] = useState("");
  const [globalDisc, setGlobalDisc] = useState(""); // global % discount, auto-applies to every line
  const [packing, setPacking] = useState("");
  const [courier, setCourier] = useState("");
  const [adjustment, setAdjustment] = useState(""); // ± round-off / concession
  // Centralized payment methods — true multi-split. Each row picks an ACTIVE method + amount.
  // Empty list = paid in full (cash), matching the previous default behaviour.
  const cashMethod = methods.find((m) => m.kind?.toLowerCase() === "cash");
  const [payLines, setPayLines] = useState<PayLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [allowBackorder, setAllowBackorder] = useState(false);

  const pct = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 100 ? n : 0; };
  const gDisc = pct(globalDisc);

  /** Tier base unit. WC uses the wholesale rate (falls back to retail if missing/zero so it
   *  never bills ₹0). The tier follows the selected customer. */
  const baseUnit = (l: Line | P) => (custType === "wholesale" && l.wholesale > 0 ? l.wholesale : l.price);
  /** Effective unit (paise): manual price override → else per-line discount → else global discount → tier base.
   *  IMPORTANT: an EMPTY line discount inherits the global %, but an explicit "0" means zero discount
   *  (so clearing a line's 3% back to 0 restores full price — the bug the owner reported). */
  const effUnit = (l: Line) => {
    const ov = l.override.trim();
    if (ov !== "" && Number.isFinite(Number(ov)) && Number(ov) >= 0) return Math.round(Number(ov) * 100);
    const d = l.disc.trim() !== "" ? pct(l.disc) : gDisc;
    const base = baseUnit(l);
    return d > 0 ? Math.round((base * (100 - d)) / 100) : base;
  };
  /** Per-unit printed MRP (falls back to the tier base if a product has no MRP set). */
  const mrpUnit = (l: Line) => Math.max(l.mrp || 0, effUnit(l));

  const [custQ, setCustQ] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const custMatches = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return customers.filter((c) => (c.name ?? "").toLowerCase().includes(s) || (c.phone ?? "").includes(s)).slice(0, 6);
  }, [custQ, customers]);
  function pickCustomer(c: Cust) {
    setCust({ name: c.name, phone: c.phone });
    if (c.gstin) setGstin(c.gstin);
    setCustType(c.type === "wholesale" ? "wholesale" : "retail"); // tier auto-derived from the customer
    setCustQ(""); setCustOpen(false);
  }
  function walkIn(type: "retail" | "wholesale") {
    setCust({ name: type === "wholesale" ? "Cash (W)" : "Cash (R)", phone: "" });
    setCustType(type);
  }

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)).slice(0, 6);
  }, [q, products]);

  const toPaise = (v: string) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  const chargesTotal = Math.max(0, toPaise(packing)) + Math.max(0, toPaise(courier)) + toPaise(adjustment);
  const itemsTotal = lines.reduce((s, l) => s + effUnit(l) * l.qty, 0);          // net the customer pays for items
  const mrpTotal = lines.reduce((s, l) => s + mrpUnit(l) * l.qty, 0);            // printed MRP total
  const discountTotal = Math.max(0, mrpTotal - itemsTotal);                      // saving vs MRP (what the customer sees)
  const total = itemsTotal + chargesTotal;
  const received = payLines.reduce((s, l) => s + (Number(l.amount) || 0) * 100, 0);
  const remaining = total - received;
  const addPayLine = () => setPayLines((p) => [...p, { methodId: methods[0]?.id ?? "", amount: "" }]);
  const setPayLine = (i: number, patch: Partial<PayLine>) => setPayLines((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  function addLine(p: P) { setLines((prev) => { const ex = prev.find((l) => l.sku === p.sku); if (ex) return prev.map((l) => l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l); return [...prev, { sku: p.sku, name: p.name, price: p.price, wholesale: p.wholesale, mrp: p.mrp, qty: 1, stock: p.qty, override: "", disc: "" }]; }); setQ(""); }
  function setQty(sku: string, qty: number) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, qty: Math.max(1, Math.floor(qty || 1)) } : l)); }
  function setOverride(sku: string, val: string) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, override: val } : l)); }
  function setLineDisc(sku: string, val: string) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, disc: val } : l)); }
  function rm(sku: string) { setLines((p) => p.filter((l) => l.sku !== sku)); }

  /** Barcode scanner sends "<SKU>\n" — match exactly and add, showing available stock. */
  function onScan(raw: string) {
    const code = raw.trim();
    if (!code) return;
    const p = products.find((x) => x.sku.toLowerCase() === code.toLowerCase());
    if (p) {
      addLine(p);
      setScanMsg({ text: `✓ ${p.name} added · ${p.qty} in stock${p.qty <= 0 ? " (OUT OF STOCK)" : ""}`, ok: p.qty > 0 });
    } else {
      setScanMsg({ text: `✕ No product with SKU “${code}”`, ok: false });
    }
    setScan("");
    scanRef.current?.focus();
  }

  async function complete() {
    setBusy(true); setErr("");
    // Tenders from the centralized payment-method picker (multi-split). Empty = paid-in-full cash.
    const validPays = payLines
      .filter((l) => l.methodId && (Number(l.amount) || 0) > 0)
      .map((l) => ({ methodId: l.methodId, amount: Number(l.amount) || 0 }));
    const res = await posSaleAction({
      // Lines the owner hand-edited (price override) or that carry a discount send an explicit
      // unit; the rest are priced by the server at the customer's tier (DC/WC) via p_tier.
      items: lines.map((l) => {
        const ov = l.override.trim();
        const hasOv = ov !== "" && Number.isFinite(Number(ov)) && Number(ov) >= 0;
        if (hasOv) return { sku: l.sku, qty: l.qty, priceRupees: Number(ov) };
        const d = l.disc.trim() !== "" ? pct(l.disc) : gDisc;
        if (d > 0) return { sku: l.sku, qty: l.qty, priceRupees: effUnit(l) / 100 };
        return { sku: l.sku, qty: l.qty };
      }),
      customer: cust, payment: "cash", // mode is derived server-side from payments[]
      billType, buyerGstin: billType === "gst" ? gstin : "", buyerAddress: addr,
      ...(validPays.length ? { payments: validPays } : {}),
      allowOversell: allowBackorder, tier: custType,
      backorder: allowBackorder && lines.some((l) => l.qty > l.stock),
      packingRupees: Number(packing) || 0, courierRupees: Number(courier) || 0, adjustmentRupees: Number(adjustment) || 0,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Failed"); return; }
    router.push(`/admin/invoice/${res.orderId}`);
  }

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl p-6 shadow-card">
        <h2 className="font-medium text-ink mb-3">Add items</h2>

        {/* Barcode scan */}
        <div className="mb-3">
          <div className="flex items-center gap-2 rounded-xl border-2 border-emerald/40 bg-emerald-mist/40 px-3 py-2">
            <span className="text-emerald text-lg">▥</span>
            <input ref={scanRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(scan); } }}
              placeholder="Scan barcode or type SKU + Enter…"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-emerald-dark/50" />
            <button onClick={() => onScan(scan)} className="text-xs px-3 py-1 rounded-full bg-emerald text-white">Add</button>
          </div>
          {scanMsg && <p className={`text-xs mt-1 ${scanMsg.ok ? "text-emerald-dark" : "text-rose"}`}>{scanMsg.text}</p>}
        </div>

        <div className="relative">
          <input className={input} placeholder="…or search by name / SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
              {matches.map((p) => (
                <button key={p.sku} onClick={() => addLine(p)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-mist flex justify-between">
                  <span>{p.name} <span className="text-muted">· {p.sku}</span></span><span className="text-ink">{formatPaise(baseUnit(p))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {lines.length === 0 && <p className="text-sm text-muted">No items yet. Search above to add.</p>}
          {lines.map((l) => (
            <div key={l.sku} className="flex items-center gap-2 border-b border-sand/60 pb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{l.name}</p>
                <p className="text-xs text-muted">{l.sku} · <span className={l.qty > l.stock ? "text-rose font-medium" : "text-emerald"}>{l.stock} in stock</span>{l.qty > l.stock && <span className="text-rose"> — only {l.stock}!</span>}</p>
                <p className="text-[11px] text-muted">MRP <span className="text-ink/70">{formatPaise(mrpUnit(l))}</span>{mrpUnit(l) > effUnit(l) && <span className="text-emerald-dark"> · saves {formatPaise(mrpUnit(l) - effUnit(l))}/pc</span>}</p>
              </div>
              {/* Editable unit price — placeholder is the live tier+discount price; type to override. */}
              <label className="inline-flex items-center gap-0.5 rounded-full border border-sand px-2 py-1 text-sm" title="Edit unit price">
                <span className="text-muted text-xs">₹</span>
                <input value={l.override} onChange={(e) => setOverride(l.sku, e.target.value)} inputMode="decimal"
                  placeholder={String(Math.round(effUnit(l) / 100))}
                  className={`w-14 text-right outline-none bg-transparent ${l.override.trim() !== "" ? "text-emerald-dark font-medium" : "text-ink"}`} />
              </label>
              {/* Per-line discount % (overrides the global discount for this line). */}
              <label className="inline-flex items-center gap-0.5 rounded-full border border-sand px-2 py-1 text-sm" title="Discount % for this line">
                <input value={l.disc} onChange={(e) => setLineDisc(l.sku, e.target.value)} inputMode="decimal"
                  placeholder={gDisc > 0 ? String(gDisc) : "0"}
                  className={`w-9 text-right outline-none bg-transparent ${pct(l.disc) > 0 ? "text-emerald-dark font-medium" : "text-ink"}`} />
                <span className="text-muted text-xs">%</span>
              </label>
              <div className="inline-flex items-center rounded-full border border-sand text-sm overflow-hidden">
                <button onClick={() => setQty(l.sku, l.qty - 1)} className="px-2 py-1 hover:bg-cream" aria-label="decrease">−</button>
                <QtyField value={l.qty} onChange={(n) => setQty(l.sku, n)} className="w-10 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
                <button onClick={() => setQty(l.sku, l.qty + 1)} className="px-2 py-1 hover:bg-cream" aria-label="increase">+</button>
              </div>
              <span className="text-sm font-medium w-16 text-right">{formatPaise(effUnit(l) * l.qty)}</span>
              <button onClick={() => rm(l.sku)} className="text-muted hover:text-rose text-xs">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-card h-fit">
        <h2 className="font-medium text-ink mb-3">Customer &amp; payment</h2>
        <div className="space-y-3">
          {/* Bill type */}
          <div>
            <p className="text-xs text-muted mb-1">Bill type</p>
            <div className="grid grid-cols-2 gap-2">
              {([["gst", "GST Invoice"], ["cash", "Cash Memo"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setBillType(v)} className={`rounded-xl border px-3 py-2 text-sm transition-all ${billType === v ? "border-emerald bg-emerald-mist text-emerald" : "border-sand text-muted hover:border-gold"}`}>{label}</button>
              ))}
            </div>
          </div>
          {/* Customer — drives the price tier automatically. Walk-ins use Cash (R)/Cash (W). */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs text-muted">Customer</p>
              <span title={custType === "wholesale" ? "Wholesale price" : "Retail price"} className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${custType === "wholesale" ? "bg-wine/10 text-wine" : "bg-emerald-mist text-emerald-dark"}`}>{TIER_LABEL[custType]}</span>
            </div>
            <div className="flex gap-2 mb-2">
              <button onClick={() => walkIn("retail")} className="flex-1 rounded-xl border border-sand px-3 py-1.5 text-sm text-muted hover:border-emerald">Cash (R)</button>
              <button onClick={() => walkIn("wholesale")} className="flex-1 rounded-xl border border-sand px-3 py-1.5 text-sm text-muted hover:border-emerald">Cash (W)</button>
            </div>
            {customers.length > 0 && (
              <div className="relative">
                <input className={input} placeholder="🔎 Find existing customer by name / phone…" value={custQ}
                  onChange={(e) => { setCustQ(e.target.value); setCustOpen(true); }} onFocus={() => setCustOpen(true)} />
                {custOpen && custQ.trim() && (
                  <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
                    {custMatches.map((c) => (
                      <button key={c.id} onClick={() => pickCustomer(c)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-mist flex justify-between">
                        <span>{c.name} <span className="text-muted">· {c.phone || "no phone"}</span></span>
                        <span className={`text-xs ${c.type === "wholesale" ? "text-wine" : "text-muted"}`}>{TIER_LABEL[c.type] ?? "R"}</span>
                      </button>
                    ))}
                    {!custMatches.some((c) => (c.name ?? "").toLowerCase() === custQ.trim().toLowerCase()) && (
                      <button onClick={() => { setCust({ name: custQ.trim(), phone: "" }); setCustQ(""); setCustOpen(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-emerald-dark hover:bg-gold/10 border-t border-sand">
                        + Add “{custQ.trim()}” as a new customer
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            <input className={`${input} mt-2`} placeholder="Customer / firm name (override)" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
            <input className={`${input} mt-2`} placeholder="Phone (optional)" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
          </div>
          {/* Global discount — auto-applies to every line; a line's own % overrides it. */}
          <div>
            <p className="text-xs text-muted mb-1">Global discount <span className="text-muted/70">— applies to all lines</span></p>
            <div className="inline-flex items-center gap-1 rounded-xl border border-sand px-3 py-2 text-sm">
              <input value={globalDisc} onChange={(e) => setGlobalDisc(e.target.value)} inputMode="decimal" placeholder="0"
                className={`w-14 text-right outline-none bg-transparent ${gDisc > 0 ? "text-emerald-dark font-medium" : "text-ink"}`} />
              <span className="text-muted text-xs">% off every product</span>
            </div>
          </div>
          {/* Other charges — Packing / Courier / Adjustment (GST-applicable, added to the bill). */}
          <div>
            <p className="text-xs text-muted mb-1">Other charges <span className="text-muted/70">— GST applies</span></p>
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] text-muted">Packing ₹<input value={packing} onChange={(e) => setPacking(e.target.value)} inputMode="decimal" placeholder="0" className={`${input} mt-0.5`} /></label>
              <label className="text-[11px] text-muted">Courier ₹<input value={courier} onChange={(e) => setCourier(e.target.value)} inputMode="decimal" placeholder="0" className={`${input} mt-0.5`} /></label>
              <label className="text-[11px] text-muted">Adjust ± ₹<input value={adjustment} onChange={(e) => setAdjustment(e.target.value)} inputMode="decimal" placeholder="0" className={`${input} mt-0.5`} /></label>
            </div>
          </div>
          {billType === "gst" && (
            <>
              <input className={input} placeholder="Buyer GSTIN (for B2B tax invoice)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
              <textarea className={input} rows={2} placeholder="Buyer billing address (optional)" value={addr} onChange={(e) => setAddr(e.target.value)} />
            </>
          )}
          {/* Payment received — centralized multi-split. Methods come from Bank & Payment Methods. */}
          <div>
            <p className="text-xs text-muted mb-1.5">Payment received in <span className="text-muted/70">— leave empty for paid-in-full (cash)</span></p>
            {methods.length === 0 ? (
              <p className="text-[11px] text-muted bg-cream/60 rounded-lg px-3 py-2">No payment methods yet — add them in <b>Bank &amp; Payment Methods</b>.</p>
            ) : (
              <div className="space-y-2">
                {payLines.map((l, idx) => (
                  <div key={idx} className="flex gap-2">
                    <select value={l.methodId} onChange={(e) => setPayLine(idx, { methodId: e.target.value })} className={`${input} flex-1`}>
                      <option value="">Select method…</option>
                      {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <input value={l.amount} onChange={(e) => setPayLine(idx, { amount: e.target.value })} inputMode="numeric" placeholder="₹0" className={`${input} w-28`} />
                    <button type="button" onClick={() => setPayLines((p) => p.filter((_, i) => i !== idx))} className="px-2 text-muted hover:text-rose" title="Remove payment">✕</button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2 pt-0.5">
                  <button type="button" onClick={addPayLine} className="text-[11px] px-3 py-1.5 rounded-full border border-sand text-ink hover:border-emerald">+ Add Another Payment</button>
                  {cashMethod && <button type="button" onClick={() => setPayLines([{ methodId: cashMethod.id, amount: String(Math.round(total / 100)) }])} className="text-[11px] px-3 py-1.5 rounded-full border border-sand text-muted hover:border-emerald">All cash</button>}
                  {payLines.length > 0 && remaining > 0 && (
                    <button type="button" onClick={() => setPayLine(payLines.length - 1, { amount: String((((Number(payLines[payLines.length - 1].amount) || 0) * 100 + remaining) / 100)) })} className="text-[11px] px-3 py-1.5 rounded-full border border-sand text-muted hover:border-emerald">Fill remaining {formatPaise(remaining)}</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 border-t border-sand pt-4 space-y-1.5">
          {/* MRP → discount → net, exactly as the cash memo reads. */}
          <div className="flex justify-between text-sm"><span className="text-muted">Total MRP</span><span className="text-ink/80">{formatPaise(mrpTotal)}</span></div>
          {discountTotal > 0 && <div className="flex justify-between text-sm"><span className="text-muted">Discount</span><span className="text-emerald-dark">− {formatPaise(discountTotal)}</span></div>}
          <div className="flex justify-between text-sm"><span className="text-muted">Net (items)</span><span className="text-ink/80">{formatPaise(itemsTotal)}</span></div>
          {chargesTotal !== 0 && <div className="flex justify-between text-sm"><span className="text-muted">Other charges</span><span className="text-ink/80">{chargesTotal > 0 ? "+ " : ""}{formatPaise(chargesTotal)}</span></div>}
          <div className="flex justify-between items-baseline pt-1.5 border-t border-sand/60"><span className="text-muted">Amount payable</span><span className="text-3xl font-semibold text-ink">{formatPaise(total)}</span></div>
        </div>
        {received > 0 && (
          <p className={`text-xs mt-1 text-right ${remaining > 0 ? "text-rose" : "text-emerald-dark"}`}>
            Received {formatPaise(received)}{remaining > 0 ? ` · balance due ${formatPaise(remaining)}` : remaining < 0 ? ` · change ${formatPaise(-remaining)}` : " · settled"}
          </p>
        )}
        {lines.some((l) => l.qty > l.stock) && (
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-gold/60 bg-gold/10 px-3 py-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} className="mt-0.5" />
            <span>Some lines exceed available stock. Tick to <b>bill anyway as a backorder</b> — otherwise the sale is blocked to prevent overselling.</span>
          </label>
        )}
        {err && <p className="text-sm text-rose mt-2">{err}</p>}
        <button onClick={complete} disabled={busy || lines.length === 0} className="btn-primary w-full mt-4 py-3.5 text-sm font-medium disabled:opacity-50">
          {busy ? "Completing…" : billType === "gst" ? "Generate tax invoice" : "Generate cash memo"}
        </button>
      </div>
    </div>
  );
}
