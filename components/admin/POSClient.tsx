"use client";
import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { posSaleAction } from "@/app/actions/orders";
import { QtyField } from "@/components/admin/QtyField";

type P = { sku: string; name: string; price: number; wholesale: number; category: string; qty: number };
type Line = { sku: string; name: string; price: number; wholesale: number; qty: number; stock: number; override: string };
type Cust = { id: string; name: string; phone: string; type: string; gstin: string };

export function POSClient({ products, customers = [] }: { products: P[]; customers?: Cust[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [cust, setCust] = useState({ name: "", phone: "" });
  const [billType, setBillType] = useState<"gst" | "cash">("gst");
  const [gstin, setGstin] = useState("");
  const [addr, setAddr] = useState("");
  const [payCash, setPayCash] = useState("");
  const [payBank, setPayBank] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [allowBackorder, setAllowBackorder] = useState(false);
  const [tier, setTier] = useState<"retail" | "wholesale">("retail");
  const unitOf = (l: Line | P) => (tier === "wholesale" ? l.wholesale : l.price);
  /** Effective unit price for a cart line: the owner's manual override if entered
   *  (Pillar 15 — counter discount / custom rate), otherwise the tier price. */
  const effUnit = (l: Line) => {
    const ov = l.override.trim();
    if (ov !== "" && Number.isFinite(Number(ov)) && Number(ov) >= 0) return Math.round(Number(ov) * 100);
    return unitOf(l);
  };
  const [custQ, setCustQ] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const custMatches = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    // Null-safe — a customer saved without a name/phone must never break the search.
    return customers.filter((c) => (c.name ?? "").toLowerCase().includes(s) || (c.phone ?? "").includes(s)).slice(0, 6);
  }, [custQ, customers]);
  function pickCustomer(c: Cust) {
    setCust({ name: c.name, phone: c.phone });
    if (c.gstin) setGstin(c.gstin);
    if (c.type === "wholesale") setTier("wholesale");
    setCustQ(""); setCustOpen(false);
  }

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)).slice(0, 6);
  }, [q, products]);

  const total = lines.reduce((s, l) => s + effUnit(l) * l.qty, 0);
  function addLine(p: P) { setLines((prev) => { const ex = prev.find((l) => l.sku === p.sku); if (ex) return prev.map((l) => l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l); return [...prev, { sku: p.sku, name: p.name, price: p.price, wholesale: p.wholesale, qty: 1, stock: p.qty, override: "" }]; }); setQ(""); }
  function setQty(sku: string, qty: number) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, qty: Math.max(1, Math.floor(qty || 1)) } : l)); }
  function setOverride(sku: string, val: string) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, override: val } : l)); }
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
    const cTxt = payCash.trim(), bTxt = payBank.trim();
    const anySplit = cTxt !== "" || bTxt !== "";
    const c = Number(cTxt) || 0, b = Number(bTxt) || 0;
    const mode = anySplit ? (c > 0 && b > 0 ? "split" : b > 0 ? "upi" : "cash") : "cash";
    const res = await posSaleAction({
      items: lines.map((l) => ({ sku: l.sku, qty: l.qty, ...(l.override.trim() !== "" && Number(l.override) >= 0 ? { priceRupees: Number(l.override) } : {}) })),
      customer: cust, payment: mode,
      billType, buyerGstin: billType === "gst" ? gstin : "", buyerAddress: addr,
      // Blank split → treat as paid in full (cash). Any entry → record the cash/bank split.
      ...(anySplit ? { payCashRupees: c, payBankRupees: b } : {}),
      allowOversell: allowBackorder, tier,
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
                  <span>{p.name} <span className="text-muted">· {p.sku}</span></span><span className="text-ink">{formatPaise(unitOf(p))}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {lines.length === 0 && <p className="text-sm text-muted">No items yet. Search above to add.</p>}
          {lines.map((l) => (
            <div key={l.sku} className="flex items-center gap-3 border-b border-sand/60 pb-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-ink truncate">{l.name}</p>
                <p className="text-xs text-muted">{l.sku} · <span className={l.qty > l.stock ? "text-rose font-medium" : "text-emerald"}>{l.stock} in stock</span>{l.qty > l.stock && <span className="text-rose"> — only {l.stock} available!</span>}</p>
              </div>
              {/* Editable unit price (Pillar 15) — placeholder is the tier price; type to override. */}
              <label className="inline-flex items-center gap-1 rounded-full border border-sand px-2 py-1 text-sm" title="Edit unit price (discount / custom rate)">
                <span className="text-muted text-xs">₹</span>
                <input
                  value={l.override}
                  onChange={(e) => setOverride(l.sku, e.target.value)}
                  inputMode="decimal"
                  placeholder={String(Math.round(unitOf(l) / 100))}
                  className={`w-16 text-right outline-none bg-transparent ${l.override.trim() !== "" ? "text-emerald-dark font-medium" : "text-ink"}`}
                />
              </label>
              <div className="inline-flex items-center rounded-full border border-sand text-sm overflow-hidden">
                <button onClick={() => setQty(l.sku, l.qty - 1)} className="px-2.5 py-1 hover:bg-cream" aria-label="decrease">−</button>
                <QtyField value={l.qty} onChange={(n) => setQty(l.sku, n)} className="w-12 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
                <button onClick={() => setQty(l.sku, l.qty + 1)} className="px-2.5 py-1 hover:bg-cream" aria-label="increase">+</button>
              </div>
              <span className="text-sm font-medium w-20 text-right">{formatPaise(effUnit(l) * l.qty)}</span>
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
          {/* Existing-customer picker (#3) */}
          {customers.length > 0 && (
            <div className="relative">
              <input className={input} placeholder="🔎 Find existing customer by name / phone…" value={custQ}
                onChange={(e) => { setCustQ(e.target.value); setCustOpen(true); }} onFocus={() => setCustOpen(true)} />
              {custOpen && custQ.trim() && (
                <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
                  {custMatches.map((c) => (
                    <button key={c.id} onClick={() => pickCustomer(c)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-mist flex justify-between">
                      <span>{c.name} <span className="text-muted">· {c.phone || "no phone"}</span></span>
                      <span className={`text-xs ${c.type === "wholesale" ? "text-wine" : "text-muted"}`}>{c.type}</span>
                    </button>
                  ))}
                  {/* Always allow adding a brand-new customer by the typed name. */}
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
          {/* Price list — retailers get wholesale rates (#16) */}
          <div>
            <p className="text-xs text-muted mb-1">Price list</p>
            <div className="grid grid-cols-2 gap-2">
              {([["retail", "Retail (D2C)"], ["wholesale", "Wholesale"]] as const).map(([v, label]) => (
                <button key={v} onClick={() => setTier(v)} className={`rounded-xl border px-3 py-2 text-sm transition-all ${tier === v ? "border-emerald bg-emerald-mist text-emerald" : "border-sand text-muted hover:border-gold"}`}>{label}</button>
              ))}
            </div>
            {tier === "wholesale" && <p className="text-[11px] text-gold-dark mt-1">Billing at wholesale rates — use for approved retailers.</p>}
          </div>
          <input className={input} placeholder="Customer / firm name (optional)" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
          <input className={input} placeholder="Phone (optional)" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
          {billType === "gst" && (
            <>
              <input className={input} placeholder="Buyer GSTIN (for B2B tax invoice)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />
              <textarea className={input} rows={2} placeholder="Buyer billing address (optional)" value={addr} onChange={(e) => setAddr(e.target.value)} />
            </>
          )}
          {/* Split tender — record how much came via cash vs UPI/bank (#14/#37) */}
          <div>
            <p className="text-xs text-muted mb-1">Payment received <span className="text-muted/70">— leave blank for paid-in-full (cash)</span></p>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted">Cash ₹<input value={payCash} onChange={(e) => setPayCash(e.target.value)} inputMode="numeric" placeholder="0" className={`${input} mt-0.5`} /></label>
              <label className="text-[11px] text-muted">UPI / Card ₹<input value={payBank} onChange={(e) => setPayBank(e.target.value)} inputMode="numeric" placeholder="0" className={`${input} mt-0.5`} /></label>
            </div>
            <div className="flex gap-2 mt-1.5">
              <button onClick={() => { setPayCash(String(Math.round(total / 100))); setPayBank(""); }} className="text-[11px] px-2 py-1 rounded-full border border-sand text-muted hover:border-emerald">All cash</button>
              <button onClick={() => { setPayBank(String(Math.round(total / 100))); setPayCash(""); }} className="text-[11px] px-2 py-1 rounded-full border border-sand text-muted hover:border-emerald">All UPI</button>
            </div>
          </div>
        </div>
        <div className="mt-5 border-t border-sand pt-4 flex justify-between items-baseline">
          <span className="text-muted">Total</span><span className="text-3xl font-semibold text-ink">{formatPaise(total)}</span>
        </div>
        {(() => {
          const recv = (Number(payCash) || 0) * 100 + (Number(payBank) || 0) * 100;
          if (recv === 0) return null;
          const bal = total - recv;
          return (
            <p className={`text-xs mt-1 text-right ${bal > 0 ? "text-rose" : "text-emerald-dark"}`}>
              Received {formatPaise(recv)}{bal > 0 ? ` · balance due ${formatPaise(bal)}` : bal < 0 ? ` · change ${formatPaise(-bal)}` : " · settled"}
            </p>
          );
        })()}
        {lines.some((l) => l.qty > l.stock) && (
          <label className="mt-3 flex items-start gap-2 rounded-xl border border-gold/60 bg-gold/10 px-3 py-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} className="mt-0.5" />
            <span>Some lines exceed available stock. Tick to <b>bill anyway as a backorder</b> — otherwise the sale is blocked to prevent overselling.</span>
          </label>
        )}
        {err && <p className="text-sm text-rose mt-2">{err}</p>}
        <button onClick={complete} disabled={busy || lines.length === 0} className="btn-primary w-full mt-4 py-3.5 text-sm font-medium disabled:opacity-50">
          {busy ? "Completing…" : billType === "gst" ? "Complete sale & print tax invoice" : "Complete sale & print cash memo"}
        </button>
      </div>
    </div>
  );
}
