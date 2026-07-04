"use client";
import { useState, useMemo, useRef, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { posSaleAction } from "@/app/actions/orders";
import { quickAddEmployeeAction } from "@/app/actions/employees";
import { QtyField } from "@/components/admin/QtyField";

type P = { sku: string; name: string; price: number; wholesale: number; mrp: number; category: string; qty: number };
type Line = { sku: string; name: string; price: number; wholesale: number; mrp: number; qty: number; stock: number; override: string; disc: string };
type Cust = { id: string; name: string; phone: string; type: string; gstin: string };
const TIER_LABEL: Record<string, string> = { retail: "R", wholesale: "W" };
type Method = { id: string; name: string; kind: string };
type Emp = { id: string; name: string };
type PayLine = { methodId: string; amount: string };

export function POSClient({ products, customers = [], methods = [], employees = [] }: { products: P[]; customers?: Cust[]; methods?: Method[]; employees?: Emp[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const discRef = useRef<HTMLInputElement>(null);
  const payRef = useRef<HTMLSelectElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cust, setCust] = useState({ name: "", phone: "" });
  const [custType, setCustType] = useState<"retail" | "wholesale">("retail");
  const [salesEmp, setSalesEmp] = useState(""); // who dealt with the customer (performance attribution)
  // Local, editable roster so a staffer can add their name here and be selected immediately.
  const [emps, setEmps] = useState<Emp[]>(employees);
  const [addingEmp, setAddingEmp] = useState(false);
  const [newEmpName, setNewEmpName] = useState("");
  const [empBusy, setEmpBusy] = useState(false);
  const empRef = useRef<HTMLSelectElement>(null);
  /** Add (or reuse) a salesperson by name from the POS box, then select them for this sale. */
  async function addEmp() {
    const n = newEmpName.trim();
    if (!n) return;
    setEmpBusy(true);
    const r = await quickAddEmployeeAction(n);
    setEmpBusy(false);
    if (r.ok && r.id) {
      setEmps((prev) => (prev.some((e) => e.id === r.id) ? prev : [...prev, { id: r.id!, name: r.name || n }]));
      setSalesEmp(r.id); setNewEmpName(""); setAddingEmp(false); setErr("");
    } else setErr(r.error ?? "Could not add employee");
  }
  const [custPanel, setCustPanel] = useState(false);
  const [billType, setBillType] = useState<"gst" | "cash">("gst");
  const [gstin, setGstin] = useState("");
  const [addr, setAddr] = useState("");
  const [globalDisc, setGlobalDisc] = useState("");
  const [packing, setPacking] = useState("");
  const [courier, setCourier] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const cashMethod = methods.find((m) => m.kind?.toLowerCase() === "cash");
  const [payLines, setPayLines] = useState<PayLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [allowBackorder, setAllowBackorder] = useState(false);

  const pct = (v: string) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n < 100 ? n : 0; };
  const gDisc = pct(globalDisc);
  const baseUnit = (l: Line | P) => (custType === "wholesale" && l.wholesale > 0 ? l.wholesale : l.price);
  // rawUnit = the ORIGINAL unit rate shown in the Rate column (a manual override, else the tier rate).
  // It does NOT change when a discount is applied — the discount only affects the Amount.
  const rawUnit = (l: Line) => {
    const ov = l.override.trim();
    if (ov !== "" && Number.isFinite(Number(ov)) && Number(ov) >= 0) return Math.round(Number(ov) * 100);
    return baseUnit(l);
  };
  const lineDiscPct = (l: Line) => (l.disc.trim() !== "" ? pct(l.disc) : gDisc);
  // effUnit = the discounted unit that actually bills (Amount = effUnit × qty). Discount applies on
  // top of the Rate (override or tier), so Rate stays original and Amount reflects the discount.
  const effUnit = (l: Line) => {
    const d = lineDiscPct(l);
    const base = rawUnit(l);
    return d > 0 ? Math.round((base * (100 - d)) / 100) : base;
  };
  const mrpUnit = (l: Line) => Math.max(l.mrp || 0, rawUnit(l));

  const [custQ, setCustQ] = useState("");
  const custMatches = useMemo(() => {
    const s = custQ.trim().toLowerCase();
    if (!s) return [];
    return customers.filter((c) => (c.name ?? "").toLowerCase().includes(s) || (c.phone ?? "").includes(s)).slice(0, 6);
  }, [custQ, customers]);
  function pickCustomer(c: Cust) {
    setCust({ name: c.name, phone: c.phone });
    if (c.gstin) setGstin(c.gstin);
    setCustType(c.type === "wholesale" ? "wholesale" : "retail");
    setCustQ(""); setCustPanel(false);
  }
  function walkIn(type: "retail" | "wholesale") {
    setCust({ name: type === "wholesale" ? "Cash (W)" : "Cash (R)", phone: "" });
    setCustType(type); setCustPanel(false);
  }

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s)).slice(0, 8);
  }, [q, products]);

  const toPaise = (v: string) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
  const chargesTotal = Math.max(0, toPaise(packing)) + Math.max(0, toPaise(courier)) + toPaise(adjustment);
  const itemsTotal = lines.reduce((s, l) => s + effUnit(l) * l.qty, 0);
  const mrpTotal = lines.reduce((s, l) => s + mrpUnit(l) * l.qty, 0);
  const discountTotal = Math.max(0, mrpTotal - itemsTotal);
  const total = itemsTotal + chargesTotal;
  const GST_RATE = 3;
  const gstOnBill = billType === "gst" ? Math.round((total * GST_RATE) / 100) : 0;
  const grandTotal = total + gstOnBill;
  const received = payLines.reduce((s, l) => s + (Number(l.amount) || 0) * 100, 0);
  const remaining = grandTotal - received;
  const addPayLine = () => setPayLines((p) => [...p, { methodId: methods[0]?.id ?? "", amount: "" }]);
  const setPayLine = (i: number, patch: Partial<PayLine>) => setPayLines((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  function addLine(p: P) { setLines((prev) => { const ex = prev.find((l) => l.sku === p.sku); if (ex) return prev.map((l) => l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l); return [...prev, { sku: p.sku, name: p.name, price: p.price, wholesale: p.wholesale, mrp: p.mrp, qty: 1, stock: p.qty, override: "", disc: "" }]; }); setQ(""); }
  function setQty(sku: string, qty: number) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, qty: Math.max(1, Math.floor(qty || 1)) } : l)); }
  function setOverride(sku: string, val: string) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, override: val } : l)); }
  function setLineDisc(sku: string, val: string) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, disc: val } : l)); }
  function rm(sku: string) { setLines((p) => p.filter((l) => l.sku !== sku)); }

  /** One box for scan + search: Enter adds the exact SKU match, else the first result. */
  function submitSearch() {
    const code = q.trim();
    if (!code) return;
    const exact = products.find((x) => x.sku.toLowerCase() === code.toLowerCase());
    const p = exact ?? matches[0];
    if (p) { addLine(p); setScanMsg({ text: `✓ ${p.name} · ${p.qty} in stock${p.qty <= 0 ? " (OUT)" : ""}`, ok: p.qty > 0 }); }
    else setScanMsg({ text: `✕ No product “${code}”`, ok: false });
    setQ(""); searchRef.current?.focus();
  }

  async function complete() {
    if (busy || lines.length === 0) return;
    // Require attribution so every bill lands on an employee's tally (the whole point of tracking).
    if (!salesEmp) {
      setErr('Pick who made this sale under "Sold by" — or add their name — before recording the bill.');
      setAddingEmp(emps.length === 0); // if the roster is empty, open the add-name box straight away
      empRef.current?.focus();
      return;
    }
    setBusy(true); setErr("");
    const validPays = payLines.filter((l) => l.methodId && (Number(l.amount) || 0) > 0).map((l) => ({ methodId: l.methodId, amount: Number(l.amount) || 0 }));
    const res = await posSaleAction({
      items: lines.map((l) => {
        const ov = l.override.trim();
        const hasOv = ov !== "" && Number.isFinite(Number(ov)) && Number(ov) >= 0;
        const d = lineDiscPct(l);
        // When a rate is overridden OR a discount applies, bill the NET unit and also record the
        // ORIGINAL rate (listRupees) so the invoice can show Rate → Disc → Amount.
        if (hasOv || d > 0) return { sku: l.sku, qty: l.qty, priceRupees: effUnit(l) / 100, listRupees: rawUnit(l) / 100 };
        return { sku: l.sku, qty: l.qty };
      }),
      customer: cust, payment: "cash",
      billType, buyerGstin: billType === "gst" ? gstin : "", buyerAddress: addr,
      ...(validPays.length ? { payments: validPays } : {}),
      allowOversell: allowBackorder, tier: custType, salesEmployeeId: salesEmp || undefined,
      backorder: allowBackorder && lines.some((l) => l.qty > l.stock),
      packingRupees: Number(packing) || 0, courierRupees: Number(courier) || 0, adjustmentRupees: Number(adjustment) || 0,
    });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Failed"); return; }
    router.push(`/admin/invoice/${res.orderId}`);
  }

  // ---- keyboard-first shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F3") { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); }
      else if (e.key === "F2") { e.preventDefault(); setCustPanel((v) => !v); }
      else if (e.key === "F5") { e.preventDefault(); setMoreOpen(true); setTimeout(() => discRef.current?.focus(), 0); }
      else if (e.key === "F4") { e.preventDefault(); if (methods.length && payLines.length === 0) addPayLine(); setTimeout(() => payRef.current?.focus(), 0); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); complete(); }
      else if (e.key === "Escape") { setCustPanel(false); setScanMsg(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const inp = "rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm outline-none focus:border-emerald";
  return (
    <div className="flex flex-col gap-3">
      {/* ================= TOP BAR ================= */}
      <div className="bg-white rounded-2xl shadow-card p-3 flex flex-wrap items-center gap-3">
        {/* Bill type */}
        <div className="inline-flex rounded-lg border border-sand overflow-hidden text-sm shrink-0">
          {([["gst", "GST Invoice"], ["cash", "Cash Memo"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setBillType(v)} className={`px-3 py-2 transition-colors ${billType === v ? "bg-ink text-white" : "text-muted hover:bg-cream"}`}>{label}</button>
          ))}
        </div>

        {/* Unified product search + scan (F3, autofocus) */}
        <div className="relative flex-1 min-w-[220px]">
          <div className="flex items-center gap-2 rounded-xl border-2 border-emerald/40 bg-emerald-mist/30 px-3 py-2">
            <span className="text-emerald">▥</span>
            <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitSearch(); } }}
              placeholder="Scan barcode, or search SKU / product / category… (F3)"
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-emerald-dark/50" />
            <kbd className="text-[10px] text-emerald-dark/60 border border-emerald/30 rounded px-1">Enter</kbd>
          </div>
          {matches.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
              {matches.map((p) => (
                <button key={p.sku} onClick={() => { addLine(p); searchRef.current?.focus(); }} className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-mist flex justify-between items-center">
                  <span className="truncate">{p.name} <span className="text-muted">· {p.sku}</span> <span className={`text-[11px] ${p.qty <= 0 ? "text-rose" : "text-muted"}`}>({p.qty})</span></span>
                  <span className="text-ink shrink-0 ml-2">{formatPaise(baseUnit(p))}</span>
                </button>
              ))}
            </div>
          )}
          {scanMsg && <p className={`text-[11px] mt-0.5 absolute ${scanMsg.ok ? "text-emerald-dark" : "text-rose"}`}>{scanMsg.text}</p>}
        </div>

        {/* Salesperson (employee sales attribution) — REQUIRED so every bill is tracked. Staff can
            pick from the roster or add their own name on the spot. */}
        <div className="shrink-0">
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${salesEmp ? "border-emerald" : "border-gold"}`}>
            <span className="text-muted text-xs whitespace-nowrap">☺ Sold by<span className="text-rose" title="Required">*</span></span>
            <select ref={empRef} value={salesEmp} onChange={(e) => setSalesEmp(e.target.value)} className="bg-transparent outline-none text-ink max-w-[130px]">
              <option value="">— select —</option>
              {emps.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
            <button type="button" onClick={() => setAddingEmp((v) => !v)} className="text-emerald-dark text-xs hover:underline whitespace-nowrap" title="Add a new salesperson">＋ New</button>
          </div>
          {addingEmp && (
            <div className="mt-1 flex items-center gap-1">
              <input value={newEmpName} onChange={(e) => setNewEmpName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addEmp(); } }}
                placeholder="Type your name" autoFocus
                className="rounded-lg border border-sand px-2 py-1 text-xs w-32 outline-none focus:border-emerald" />
              <button type="button" onClick={addEmp} disabled={empBusy || !newEmpName.trim()}
                className="text-xs px-2 py-1 rounded-lg bg-ink text-white disabled:opacity-50">{empBusy ? "…" : "Add"}</button>
            </div>
          )}
        </div>

        {/* Compact customer chip (F2) */}
        <div className="relative shrink-0">
          <button onClick={() => setCustPanel((v) => !v)} className="flex items-center gap-2 rounded-xl border border-sand px-3 py-2 text-sm hover:border-emerald">
            <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${custType === "wholesale" ? "bg-wine/10 text-wine" : "bg-emerald-mist text-emerald-dark"}`}>{TIER_LABEL[custType]}</span>
            <span className="text-ink max-w-[160px] truncate">{cust.name || "Walk-in customer"}</span>
            {cust.phone && <span className="text-muted text-xs">· {cust.phone}</span>}
            <span className="text-muted text-xs">▾ <span className="text-[10px]">F2</span></span>
          </button>
          {custPanel && (
            <div className="absolute z-30 right-0 mt-1 w-80 bg-white rounded-xl shadow-luxe border border-sand p-3 space-y-2">
              <div className="flex gap-2">
                <button onClick={() => walkIn("retail")} className="flex-1 rounded-lg border border-sand px-3 py-1.5 text-sm hover:border-emerald">Cash (R)</button>
                <button onClick={() => walkIn("wholesale")} className="flex-1 rounded-lg border border-sand px-3 py-1.5 text-sm hover:border-emerald">Cash (W)</button>
              </div>
              {customers.length > 0 && (
                <div className="relative">
                  <input autoFocus className={`${inp} w-full`} placeholder="🔎 Find customer by name / phone…" value={custQ} onChange={(e) => setCustQ(e.target.value)} />
                  {custQ.trim() && (
                    <div className="mt-1 max-h-52 overflow-y-auto rounded-lg border border-sand divide-y divide-sand/60">
                      {custMatches.map((c) => (
                        <button key={c.id} onClick={() => pickCustomer(c)} className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-mist flex justify-between">
                          <span className="truncate">{c.name} <span className="text-muted">· {c.phone || "no phone"}</span></span>
                          <span className={`text-xs ${c.type === "wholesale" ? "text-wine" : "text-muted"}`}>{TIER_LABEL[c.type] ?? "R"}</span>
                        </button>
                      ))}
                      {!custMatches.some((c) => (c.name ?? "").toLowerCase() === custQ.trim().toLowerCase()) && (
                        <button onClick={() => { setCust({ name: custQ.trim(), phone: "" }); setCustQ(""); setCustPanel(false); }} className="w-full text-left px-3 py-2 text-sm text-emerald-dark hover:bg-gold/10">+ Add “{custQ.trim()}”</button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <input className={`${inp} w-full`} placeholder="Name (override)" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
              <input className={`${inp} w-full`} placeholder="Phone (optional)" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
              {billType === "gst" && <input className={`${inp} w-full`} placeholder="Buyer GSTIN (B2B)" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} />}
              <button onClick={() => setCustPanel(false)} className="w-full py-1.5 rounded-lg bg-ink text-white text-sm">Done</button>
            </div>
          )}
        </div>
      </div>

      {/* ================= PRODUCT TABLE (center, largest) ================= */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cream text-muted text-left text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 w-24">SKU</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-2 py-2 w-28 text-center">Qty</th>
                <th className="px-2 py-2 w-24 text-right">Rate ₹</th>
                <th className="px-2 py-2 w-16 text-right">Disc %</th>
                <th className="px-3 py-2 w-24 text-right">Amount</th>
                <th className="px-2 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-muted">Scan or search above to add items. <kbd className="text-[10px] border border-sand rounded px-1">F3</kbd> jumps to search.</td></tr>
              )}
              {lines.map((l) => {
                const over = l.qty > l.stock;
                return (
                  <Fragment key={l.sku}>
                    <tr className="border-t border-sand/60 hover:bg-cream/30">
                      <td className="px-3 py-1.5 font-mono text-xs text-muted align-middle">{l.sku}</td>
                      <td className="px-3 py-1.5 align-middle">
                        <button onClick={() => setExpanded(expanded === l.sku ? null : l.sku)} className="text-left text-ink hover:text-emerald flex items-center gap-1">
                          <span className="truncate max-w-[240px]">{l.name}</span>
                          <span className={`text-[10px] px-1 rounded ${over ? "bg-rose/10 text-rose" : "text-muted"}`}>{l.stock}{over ? " ⚠" : ""}</span>
                        </button>
                      </td>
                      <td className="px-2 py-1.5 align-middle">
                        <div className="inline-flex items-center rounded-lg border border-sand overflow-hidden mx-auto">
                          <button onClick={() => setQty(l.sku, l.qty - 1)} className="px-1.5 hover:bg-cream" aria-label="−">−</button>
                          <QtyField value={l.qty} onChange={(n) => setQty(l.sku, n)} className="w-9 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
                          <button onClick={() => setQty(l.sku, l.qty + 1)} className="px-1.5 hover:bg-cream" aria-label="+">+</button>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right align-middle">
                        <input value={l.override} onChange={(e) => setOverride(l.sku, e.target.value)} inputMode="decimal" placeholder={String(Math.round(baseUnit(l) / 100))}
                          className={`w-20 text-right rounded border border-transparent hover:border-sand focus:border-emerald px-1 py-0.5 outline-none ${l.override.trim() !== "" ? "text-emerald-dark font-medium" : "text-ink"}`} />
                      </td>
                      <td className="px-2 py-1.5 text-right align-middle">
                        <input value={l.disc} onChange={(e) => setLineDisc(l.sku, e.target.value)} inputMode="decimal" placeholder={gDisc > 0 ? String(gDisc) : "0"}
                          className={`w-12 text-right rounded border border-transparent hover:border-sand focus:border-emerald px-1 py-0.5 outline-none ${pct(l.disc) > 0 ? "text-emerald-dark font-medium" : "text-ink"}`} />
                      </td>
                      <td className="px-3 py-1.5 text-right font-medium align-middle">{formatPaise(effUnit(l) * l.qty)}</td>
                      <td className="px-2 py-1.5 align-middle text-right">
                        <button onClick={() => rm(l.sku)} title="Remove" className="text-muted hover:text-rose text-xs">✕</button>
                      </td>
                    </tr>
                    {expanded === l.sku && (
                      <tr className="bg-cream/40 text-xs text-muted">
                        <td></td>
                        <td colSpan={6} className="px-3 py-1.5">
                          Stock <b className="text-ink">{l.stock}</b> · MRP <b className="text-ink">{formatPaise(mrpUnit(l))}</b>
                          {mrpUnit(l) > effUnit(l) && <span className="text-emerald-dark"> · saves {formatPaise(mrpUnit(l) - effUnit(l))}/pc</span>}
                          <span> · Wholesale {formatPaise(l.wholesale || l.price)}</span>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================= BOTTOM: charges (left) + totals & payment (right, sticky) ================= */}
      <div className="grid lg:grid-cols-[1fr_360px] gap-3 items-start">
        {/* Charges / discount / notes — low priority, collapsed */}
        <div className="bg-white rounded-2xl shadow-card p-3">
          <button onClick={() => setMoreOpen((v) => !v)} className="flex items-center justify-between w-full text-sm font-medium text-ink">
            <span>Discount &amp; charges <span className="text-muted font-normal text-xs">— global disc, packing, courier, adjust {billType === "gst" ? "· buyer address" : ""}</span></span>
            <span className="text-muted text-xs">{moreOpen ? "▲" : "▼ F5"}</span>
          </button>
          {moreOpen && (
            <div className="mt-3 grid sm:grid-cols-4 gap-2">
              <label className="text-[11px] text-muted">Global disc %<input ref={discRef} value={globalDisc} onChange={(e) => setGlobalDisc(e.target.value)} inputMode="decimal" placeholder="0" className={`${inp} w-full mt-0.5`} /></label>
              <label className="text-[11px] text-muted">Packing ₹<input value={packing} onChange={(e) => setPacking(e.target.value)} inputMode="decimal" placeholder="0" className={`${inp} w-full mt-0.5`} /></label>
              <label className="text-[11px] text-muted">Courier ₹<input value={courier} onChange={(e) => setCourier(e.target.value)} inputMode="decimal" placeholder="0" className={`${inp} w-full mt-0.5`} /></label>
              <label className="text-[11px] text-muted">Adjust ± ₹<input value={adjustment} onChange={(e) => setAdjustment(e.target.value)} inputMode="decimal" placeholder="0" className={`${inp} w-full mt-0.5`} /></label>
              {billType === "gst" && <label className="text-[11px] text-muted sm:col-span-4">Buyer address<textarea rows={2} value={addr} onChange={(e) => setAddr(e.target.value)} className={`${inp} w-full mt-0.5`} /></label>}
            </div>
          )}
          {lines.some((l) => l.qty > l.stock) && (
            <label className="mt-3 flex items-start gap-2 rounded-xl border border-gold/60 bg-gold/10 px-3 py-2 text-xs text-ink cursor-pointer">
              <input type="checkbox" checked={allowBackorder} onChange={(e) => setAllowBackorder(e.target.checked)} className="mt-0.5" />
              <span>Some lines exceed stock. Tick to <b>bill as backorder</b> — otherwise blocked to prevent overselling.</span>
            </label>
          )}
        </div>

        {/* Totals + payment — sticky, always visible */}
        <div className="bg-white rounded-2xl shadow-card p-4 lg:sticky lg:top-3 space-y-1.5">
          <div className="flex justify-between text-sm"><span className="text-muted">Total MRP</span><span className="text-ink/80">{formatPaise(mrpTotal)}</span></div>
          {discountTotal > 0 && <div className="flex justify-between text-sm"><span className="text-muted">Discount</span><span className="text-emerald-dark">− {formatPaise(discountTotal)}</span></div>}
          <div className="flex justify-between text-sm"><span className="text-muted">Net (items)</span><span className="text-ink/80">{formatPaise(itemsTotal)}</span></div>
          {chargesTotal !== 0 && <div className="flex justify-between text-sm"><span className="text-muted">Other charges</span><span className="text-ink/80">{chargesTotal > 0 ? "+ " : ""}{formatPaise(chargesTotal)}</span></div>}
          {gstOnBill > 0 && <div className="flex justify-between text-sm"><span className="text-muted">GST @{GST_RATE}%</span><span className="text-ink/80">+ {formatPaise(gstOnBill)}</span></div>}
          <div className="flex justify-between items-baseline pt-1.5 border-t border-sand/60"><span className="text-muted">Payable</span><span className="text-2xl font-semibold text-ink">{formatPaise(grandTotal)}</span></div>

          {/* Payment (F4) */}
          <div className="pt-2">
            <p className="text-[11px] text-muted mb-1">Payment <span className="text-muted/70">— empty = paid in full cash</span> <span className="text-[10px]">F4</span></p>
            {methods.length === 0 ? (
              <p className="text-[11px] text-muted bg-cream/60 rounded-lg px-2 py-1.5">Add methods in Bank &amp; Payment Methods.</p>
            ) : (
              <div className="space-y-1.5">
                {payLines.map((l, idx) => (
                  <div key={idx} className="flex gap-1.5">
                    <select ref={idx === 0 ? payRef : undefined} value={l.methodId} onChange={(e) => setPayLine(idx, { methodId: e.target.value })} className={`${inp} flex-1`}>
                      <option value="">Method…</option>
                      {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <input value={l.amount} onChange={(e) => setPayLine(idx, { amount: e.target.value })} inputMode="numeric" placeholder="₹0" className={`${inp} w-24`} />
                    <button onClick={() => setPayLines((p) => p.filter((_, i) => i !== idx))} className="px-1 text-muted hover:text-rose">✕</button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={addPayLine} className="text-[11px] px-2.5 py-1 rounded-full border border-sand text-ink hover:border-emerald">+ Split</button>
                  {cashMethod && <button onClick={() => setPayLines([{ methodId: cashMethod.id, amount: String(Math.round(grandTotal / 100)) }])} className="text-[11px] px-2.5 py-1 rounded-full border border-sand text-muted hover:border-emerald">All cash</button>}
                  {payLines.length > 0 && remaining > 0 && (
                    <button onClick={() => setPayLine(payLines.length - 1, { amount: String((((Number(payLines[payLines.length - 1].amount) || 0) * 100 + remaining) / 100)) })} className="text-[11px] px-2.5 py-1 rounded-full border border-sand text-muted hover:border-emerald">Fill {formatPaise(remaining)}</button>
                  )}
                </div>
              </div>
            )}
            {received > 0 && (
              <p className={`text-[11px] mt-1 text-right ${remaining > 0 ? "text-rose" : "text-emerald-dark"}`}>
                Received {formatPaise(received)}{remaining > 0 ? ` · due ${formatPaise(remaining)}` : remaining < 0 ? ` · change ${formatPaise(-remaining)}` : " · settled"}
              </p>
            )}
          </div>

          {err && <p className="text-sm text-rose">{err}</p>}
          <button onClick={complete} disabled={busy || lines.length === 0} className="btn-primary w-full mt-2 py-3 text-sm font-medium disabled:opacity-50">
            {busy ? "Completing…" : (billType === "gst" ? "Generate tax invoice" : "Generate cash memo")} <span className="text-[10px] opacity-70">Ctrl+↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
