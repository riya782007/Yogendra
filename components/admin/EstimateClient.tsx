"use client";
import { useState, useMemo } from "react";
import { formatPaise } from "@/lib/pricing";
import { createEstimateAction } from "@/app/actions/billing";
import { QtyField } from "@/components/admin/QtyField";

type P = { sku: string; name: string; price: number; wholesale: number };
type Cust = { id: string; name: string; phone: string; type: string; gstin: string };
type Line = { sku: string; name: string; price: number; wholesale: number; qty: number; override: string };

// R = retail, W = wholesale — tier follows the selected customer (same as POS).
const TIER_LABEL: Record<string, string> = { retail: "R", wholesale: "W" };

export function EstimateClient({ products, customers = [] }: { products: P[]; customers?: Cust[] }) {
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [custType, setCustType] = useState<"retail" | "wholesale">("retail"); // from the customer
  const [packing, setPacking] = useState("");
  const [courier, setCourier] = useState("");
  const [adjustment, setAdjustment] = useState(""); // ± round-off / concession
  const [custQ, setCustQ] = useState("");
  const [custOpen, setCustOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const matches = useMemo(() => (q.trim() ? products.filter((p) => (p.name + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 6) : []), [q, products]);
  const custMatches = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return customers.filter((c) => (c.name ?? "").toLowerCase().includes(s) || (c.phone ?? "").includes(s)).slice(0, 6);
  }, [custQ, customers]);

  // WC uses the wholesale rate (falls back to retail if missing). Manual override wins.
  const baseUnit = (l: Line | P) => (custType === "wholesale" && l.wholesale > 0 ? l.wholesale : l.price);
  const effUnit = (l: Line) => {
    const ov = l.override.trim();
    if (ov !== "" && Number.isFinite(Number(ov)) && Number(ov) >= 0) return Math.round(Number(ov) * 100);
    return baseUnit(l);
  };
  const toPaise = (v: string) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  const chargesTotal = Math.max(0, toPaise(packing)) + Math.max(0, toPaise(courier)) + toPaise(adjustment);
  const total = lines.reduce((s, l) => s + effUnit(l) * l.qty, 0) + chargesTotal;

  const add = (p: P) => { setLines((prev) => (prev.find((l) => l.sku === p.sku) ? prev.map((l) => (l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l)) : [...prev, { sku: p.sku, name: p.name, price: p.price, wholesale: p.wholesale, qty: 1, override: "" }])); setQ(""); };
  const setOverride = (sku: string, v: string) => setLines((p) => p.map((l) => (l.sku === sku ? { ...l, override: v } : l)));
  function pickCustomer(c: Cust) { setName(c.name); setPhone(c.phone); setCustType(c.type === "wholesale" ? "wholesale" : "retail"); setCustQ(""); setCustOpen(false); }
  function walkIn(type: "retail" | "wholesale") { setName(type === "wholesale" ? "Cash (W)" : "Cash (R)"); setPhone(""); setCustType(type); }

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";

  async function save() {
    setBusy(true); setMsg("");
    const res = await createEstimateAction({
      // Send each line's effective rate (tier or edited) so the saved quote — and the bill it
      // converts to — uses exactly what's on screen.
      items: lines.map((l) => ({ sku: l.sku, qty: l.qty, priceRupees: effUnit(l) / 100 })),
      customer: { name, phone },
      packingRupees: Number(packing) || 0, courierRupees: Number(courier) || 0, adjustmentRupees: Number(adjustment) || 0,
    });
    setBusy(false);
    if (res.ok) { setMsg(`✓ Estimate saved (${formatPaise(res.total ?? 0)}) — find it below to bill or hold.`); setLines([]); setName(""); setPhone(""); setCustType("retail"); setPacking(""); setCourier(""); setAdjustment(""); }
    else setMsg(`✕ ${res.error}`);
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
      <h2 className="font-medium text-ink mb-3">New estimate / quotation</h2>

      {/* Customer first — drives the R/W price, same as billing. */}
      <div className="mb-3">
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
                  <button onClick={() => { setName(custQ.trim()); setCustQ(""); setCustOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm text-emerald-dark hover:bg-gold/10 border-t border-sand">+ Add “{custQ.trim()}” as a new customer</button>
                )}
              </div>
            )}
          </div>
        )}
        <div className="flex gap-2 mt-2">
          <input className={input + " flex-1"} placeholder="Customer / firm name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input + " sm:w-44"} placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>

      {/* Products */}
      <div className="relative mb-3">
        <input className={input} placeholder="Search product to add…" value={q} onChange={(e) => setQ(e.target.value)} />
        {matches.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
            {matches.map((p) => <button key={p.sku} onClick={() => add(p)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-mist flex justify-between"><span>{p.name} <span className="text-muted">· {p.sku}</span></span><span>{formatPaise(baseUnit(p))}</span></button>)}
          </div>
        )}
      </div>
      {lines.map((l) => (
        <div key={l.sku} className="flex items-center gap-2 border-b border-sand/60 py-2 text-sm">
          <span className="flex-1 min-w-0 truncate">{l.name} <span className="text-muted">· {l.sku}</span></span>
          {/* Editable rate — placeholder is the tier price; type to override. */}
          <label className="inline-flex items-center gap-0.5 rounded-full border border-sand px-2 py-1" title="Edit rate">
            <span className="text-muted text-xs">₹</span>
            <input value={l.override} onChange={(e) => setOverride(l.sku, e.target.value)} inputMode="decimal" placeholder={String(Math.round(baseUnit(l) / 100))}
              className={`w-16 text-right outline-none bg-transparent ${l.override.trim() !== "" ? "text-emerald-dark font-medium" : "text-ink"}`} />
          </label>
          <div className="inline-flex items-center rounded-full border border-sand overflow-hidden">
            <button onClick={() => setLines((p) => p.map((x) => (x.sku === l.sku ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} className="px-2.5 py-1 hover:bg-cream">−</button>
            <QtyField value={l.qty} onChange={(v) => setLines((p) => p.map((x) => (x.sku === l.sku ? { ...x, qty: v } : x)))} className="w-12 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
            <button onClick={() => setLines((p) => p.map((x) => (x.sku === l.sku ? { ...x, qty: x.qty + 1 } : x)))} className="px-2.5 py-1 hover:bg-cream">+</button>
          </div>
          <span className="w-20 text-right font-medium">{formatPaise(effUnit(l) * l.qty)}</span>
          <button onClick={() => setLines((p) => p.filter((x) => x.sku !== l.sku))} className="text-muted hover:text-rose">✕</button>
        </div>
      ))}
      {lines.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-3">
          <label className="text-[11px] text-muted">Packing ₹<input value={packing} onChange={(e) => setPacking(e.target.value)} inputMode="decimal" placeholder="0" className={`${input} mt-0.5`} /></label>
          <label className="text-[11px] text-muted">Courier ₹<input value={courier} onChange={(e) => setCourier(e.target.value)} inputMode="decimal" placeholder="0" className={`${input} mt-0.5`} /></label>
          <label className="text-[11px] text-muted">Adjust ± ₹<input value={adjustment} onChange={(e) => setAdjustment(e.target.value)} inputMode="decimal" placeholder="0" className={`${input} mt-0.5`} /></label>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 mt-4">
        <span className="text-lg font-semibold text-ink whitespace-nowrap">{formatPaise(total)}</span>
        <button onClick={save} disabled={busy || !lines.length} className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Saving…" : "Save estimate"}</button>
      </div>
      {msg && <p className="text-sm mt-2 text-ink">{msg}</p>}
    </div>
  );
}
