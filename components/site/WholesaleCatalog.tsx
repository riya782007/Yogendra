"use client";
import { useState, useMemo } from "react";
import { formatPaise, tierPctOff, applyTier, type WholesaleTier } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { QtyField } from "@/components/admin/QtyField";
import { placeWholesaleOrderAction, wholesaleLogoutAction, requestQuoteAction } from "@/app/actions/wholesale";

type P = { sku: string; name: string; category: string; qty: number; price: number; mrp: number; image: string | null; colour?: string | null };
type HistItem = { sku: string; name: string; qty: number };
type Hist = { id: string; total: number; amountPaid?: number; status?: string; paymentRef?: string | null; created_at: string; invoice_no: string | null; items: HistItem[] };
type PayInfo = { payeeName: string; upiId: string | null; qrUrl: string | null };

export function WholesaleCatalog({ products, customerName, minOrder = 300000, history = [], payInfo = null, outstanding = 0, tiers = [] }: {
  products: P[]; customerName: string; minOrder?: number; history?: Hist[]; payInfo?: PayInfo | null; outstanding?: number; tiers?: WholesaleTier[];
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [colour, setColour] = useState("all");
  const [inStock, setInStock] = useState(false);
  const [sort, setSort] = useState<"featured" | "price_asc" | "price_desc" | "margin">("featured");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);   // payment (QR + UTR) step
  const [utr, setUtr] = useState("");
  const [done, setDone] = useState<{ id: string; total: number } | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"order" | "history">("order");
  const [bulk, setBulk] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const [rfqOpen, setRfqOpen] = useState(false);   // request-a-quote (bulk/custom)
  const [rfqText, setRfqText] = useState("");
  const [rfqBusy, setRfqBusy] = useState(false);
  const [rfqDone, setRfqDone] = useState(false);
  const [rfqErr, setRfqErr] = useState("");

  async function submitQuote() {
    setRfqBusy(true); setRfqErr("");
    const res = await requestQuoteAction(rfqText.trim());
    setRfqBusy(false);
    if (res.ok) { setRfqDone(true); setRfqText(""); }
    else setRfqErr(res.error ?? "Could not send your request.");
  }

  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.toUpperCase(), p])), [products]);
  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category).filter(Boolean))).sort(), [products]);
  const colours = useMemo(() => Array.from(new Set(products.map((p) => p.colour).filter((c): c is string => !!c))).sort(), [products]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = products.filter((p) =>
      (cat === "all" || p.category === cat) &&
      (colour === "all" || (p.colour ?? "").toLowerCase() === colour.toLowerCase()) &&
      (!inStock || p.qty > 0) &&
      (!s || (p.name + p.sku + p.category + (p.colour ?? "")).toLowerCase().includes(s)));
    if (sort === "price_asc") out.sort((a, b) => a.price - b.price);
    else if (sort === "price_desc") out.sort((a, b) => b.price - a.price);
    else if (sort === "margin") out.sort((a, b) => (b.mrp - b.price) - (a.mrp - a.price));
    return out;
  }, [q, cat, colour, inStock, sort, products]);

  const sortedTiers = useMemo(() => [...(tiers ?? [])].sort((a, b) => a.minQty - b.minQty), [tiers]);
  const hasTiers = sortedTiers.length > 0;
  /** Discounted unit price for a line given its quantity (mirrors the DB RPC exactly). */
  const unitFor = (sku: string, n: number) => {
    const base = bySku.get(sku.toUpperCase())?.price ?? 0;
    return applyTier(base, tierPctOff(sortedTiers, n));
  };

  const lines = Object.entries(qty).filter(([, n]) => n > 0);
  const orderTotal = lines.reduce((s, [sku, n]) => s + unitFor(sku, n) * n, 0);
  const grossTotal = lines.reduce((s, [sku, n]) => s + (bySku.get(sku.toUpperCase())?.price ?? 0) * n, 0);
  const savings = Math.max(0, grossTotal - orderTotal);
  const itemCount = lines.reduce((s, [, n]) => s + n, 0);
  const belowMin = orderTotal > 0 && orderTotal < minOrder;
  const shortBy = Math.max(0, minOrder - orderTotal);

  /** Never let a line exceed available stock (the owner's "select jyada ho rha hai"). */
  const clamp = (sku: string, n: number) => {
    const max = bySku.get(sku.toUpperCase())?.qty ?? 0;
    return Math.max(0, Math.min(max, Math.floor(n || 0)));
  };
  const setQtyAbs = (sku: string, n: number) => setQty((s) => ({ ...s, [sku]: clamp(sku, n) }));
  const addQty = (sku: string, d: number) => setQty((s) => ({ ...s, [sku]: clamp(sku, (s[sku] ?? 0) + d) }));

  /** Open the payment step (scan QR → pay → enter UTR). */
  function goToPay() {
    if (lines.length === 0 || belowMin) return;
    setErr(""); setUtr(""); setPaying(true);
  }
  /** Finalise: record the order with the UPI reference; the owner is WhatsApp'd to verify & dispatch. */
  async function confirmOrder() {
    if (lines.length === 0) return;
    setBusy(true); setErr("");
    const res = await placeWholesaleOrderAction(lines.map(([sku, n]) => ({ sku, qty: n })), { paymentRef: utr.trim() || undefined });
    setBusy(false);
    if (res.ok) { setDone({ id: res.orderId!, total: res.total ?? 0 }); setQty({}); setPaying(false); }
    else setErr(res.error ?? "Could not place order");
  }

  function applyBulk() {
    let added = 0, missed = 0, capped = 0;
    const next = { ...qty };
    bulk.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const m = line.match(/([A-Za-z0-9-]+)\D+(\d+)/);
      if (!m) { missed++; return; }
      const p = bySku.get(m[1].toUpperCase());
      if (!p) { missed++; return; }
      const want = (next[p.sku] ?? 0) + parseInt(m[2], 10);
      const c = clamp(p.sku, want);
      if (c < want) capped++;
      next[p.sku] = c; added++;
    });
    setQty(next);
    setBulkMsg(`${added} line${added === 1 ? "" : "s"} added${capped ? ` · ${capped} capped to stock` : ""}${missed ? ` · ${missed} not recognised` : ""}.`);
    setBulk("");
  }

  function reorder(h: Hist) {
    const next = { ...qty };
    let ok = 0, gone = 0;
    h.items.forEach((it) => { if (bySku.has(it.sku.toUpperCase())) { next[it.sku] = clamp(it.sku, (next[it.sku] ?? 0) + it.qty); ok++; } else gone++; });
    setQty(next); setTab("order");
    setBulkMsg(`Reordered ${ok} item${ok === 1 ? "" : "s"}${gone ? ` · ${gone} no longer available` : ""}.`);
  }

  if (done) {
    return (
      <div className="rounded-3xl bg-white border border-sand shadow-card p-10 text-center max-w-lg mx-auto">
        <p className="text-5xl mb-3">✓</p>
        <h2 className="font-display text-3xl text-ink">Order placed</h2>
        <p className="text-muted mt-2">Wholesale order <b className="text-ink">{done.id.slice(0, 8).toUpperCase()}</b> for <b className="text-emerald">{formatPaise(done.total)}</b> is in. We'll confirm dispatch on WhatsApp.</p>
        <button onClick={() => setDone(null)} className="btn-primary px-6 py-2.5 text-sm font-medium mt-5">Place another order</button>
      </div>
    );
  }

  const Img = ({ p, className }: { p: P; className?: string }) => (
    <button onClick={() => p.image && setZoom({ src: p.image, name: p.name })} className={`block bg-cream overflow-hidden ${p.image ? "cursor-zoom-in" : ""} ${className ?? ""}`} aria-label="Enlarge">
      {p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : <ProductImage name={p.name} />}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <p className="text-sm text-muted">Signed in as</p>
          <p className="font-medium text-ink">{customerName} · <span className="text-emerald">Wholesale</span></p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-full bg-cream p-1 text-sm">
            <button onClick={() => setTab("order")} className={`px-3 py-1 rounded-full ${tab === "order" ? "bg-ink text-white" : "text-muted"}`}>Order</button>
            <button onClick={() => setTab("history")} className={`px-3 py-1 rounded-full ${tab === "history" ? "bg-ink text-white" : "text-muted"}`}>History {history.length ? `(${history.length})` : ""}</button>
          </div>
          <a href="/trade/line-sheet" target="_blank" rel="noreferrer" className="text-sm px-3 py-1 rounded-full border border-sand text-ink hover:border-emerald">↓ Line-sheet (PDF)</a>
          <button onClick={() => { setRfqOpen(true); setRfqDone(false); setRfqErr(""); }} className="text-sm px-3 py-1 rounded-full border border-gold text-gold-dark hover:bg-gold/10">Request a quote</button>
          <form action={wholesaleLogoutAction}><button className="text-sm text-muted hover:text-ink">Sign out</button></form>
        </div>
      </div>

      {/* Outstanding-balance banner: dealers see at a glance what they still owe (B2B transparency). */}
      {outstanding > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-gold/40 bg-gold/10 px-4 py-3">
          <p className="text-sm text-ink">Outstanding balance: <b className="text-gold-dark">{formatPaise(outstanding)}</b> <span className="text-muted">across your recent orders</span></p>
          <button onClick={() => setTab("history")} className="text-xs text-emerald nav-link">View orders →</button>
        </div>
      )}

      {tab === "history" ? (
        <div className="space-y-3">
          {history.length === 0 && <p className="text-sm text-muted bg-white rounded-2xl border border-sand p-6 text-center">No past orders yet — place your first below.</p>}
          {history.map((h) => {
            const due = Math.max(0, (h.total ?? 0) - (h.amountPaid ?? 0));
            const paid = due <= 0 && (h.total ?? 0) > 0;
            const st = (h.status ?? "placed").toLowerCase();
            const label = paid ? "Paid" : st === "dispatched" || st === "shipped" ? "Dispatched" : st === "cancelled" ? "Cancelled" : due > 0 ? "Payment pending" : "Placed";
            const cls = paid ? "bg-emerald-mist text-emerald-dark" : st === "cancelled" ? "bg-rose/10 text-rose" : "bg-gold/15 text-gold-dark";
            return (
              <div key={h.id} className="bg-white rounded-2xl border border-sand shadow-card p-5 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink flex items-center gap-2">{h.invoice_no || h.id.slice(0, 8).toUpperCase()} <span className="text-xs text-muted">· {new Date(h.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span><span className={`text-[10px] px-2 py-0.5 rounded-full ${cls}`}>{label}</span></p>
                  <p className="text-sm text-muted truncate">{h.items.map((i) => `${i.name} ×${i.qty}`).join(", ") || "—"}</p>
                  {h.paymentRef && <p className="text-[11px] text-muted mt-0.5">UPI ref: <span className="font-mono">{h.paymentRef}</span></p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-ink">{formatPaise(h.total)}</p>
                  {due > 0 && <p className="text-[11px] text-gold-dark">Due {formatPaise(due)}</p>}
                  <button onClick={() => reorder(h)} className="text-xs text-emerald nav-link">↻ Reorder these</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* Filters + quick order */}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search designs / SKU / colour…" className="rounded-full border border-sand px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[150px]" />
            <select value={cat} onChange={(e) => setCat(e.target.value)} className="rounded-full border border-sand px-4 py-2 text-sm bg-white outline-none focus:border-emerald">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {colours.length > 0 && (
              <select value={colour} onChange={(e) => setColour(e.target.value)} className="rounded-full border border-sand px-4 py-2 text-sm bg-white outline-none focus:border-emerald">
                <option value="all">All colours</option>
                {colours.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="rounded-full border border-sand px-4 py-2 text-sm bg-white outline-none focus:border-emerald">
              <option value="featured">Sort: Featured</option>
              <option value="price_asc">Price: low → high</option>
              <option value="price_desc">Price: high → low</option>
              <option value="margin">Best margin</option>
            </select>
            <label className="inline-flex items-center gap-1.5 rounded-full border border-sand px-4 py-2 text-sm text-ink cursor-pointer">
              <input type="checkbox" checked={inStock} onChange={(e) => setInStock(e.target.checked)} className="accent-emerald" /> In stock
            </label>
            <details className="relative">
              <summary className="cursor-pointer list-none px-4 py-2 rounded-full border border-sand text-sm text-ink hover:border-gold">⚡ Quick order</summary>
              <div className="absolute right-0 z-20 mt-2 w-80 bg-white rounded-2xl shadow-luxe border border-sand p-3">
                <p className="text-xs text-muted mb-2">Paste one per line: <code className="bg-cream px-1 rounded">SKU qty</code> (e.g. <code className="bg-cream px-1 rounded">BD1001 12</code>).</p>
                <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} className="w-full rounded-xl border border-sand px-3 py-2 text-sm font-mono outline-none focus:border-emerald" placeholder={"BD1001 12\nBD1002 6"} />
                <button onClick={applyBulk} className="btn-primary w-full mt-2 py-2 text-sm font-medium">Add to order</button>
              </div>
            </details>
          </div>
          {bulkMsg && <p className="text-xs text-emerald-dark mb-2">{bulkMsg}</p>}

          {/* Bulk-discount banner — shows dealers the quantity breaks up front. */}
          {hasTiers && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald/30 bg-emerald-mist/50 px-4 py-2.5">
              <span className="text-sm font-medium text-emerald-dark">Bulk savings:</span>
              {sortedTiers.map((t, i) => (
                <span key={i} className="text-xs bg-white border border-emerald/30 text-emerald-dark rounded-full px-2.5 py-1">Buy {t.minQty}+ → save {t.pctOff}%</span>
              ))}
              <span className="text-[11px] text-muted">per design, applied automatically</span>
            </div>
          )}

          {/* Desktop: dense table */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-cream text-muted text-left"><tr>
                <th className="p-4">Design</th><th className="p-4">SKU</th><th className="p-4">Stock</th>
                <th className="p-4 text-right">Wholesale</th><th className="p-4 text-right">MRP · your margin</th><th className="p-4 text-center">Qty</th><th className="p-4 text-right">Line total</th>
              </tr></thead>
              <tbody>
                {list.map((p) => {
                  const n = qty[p.sku] ?? 0;
                  const margin = p.mrp - p.price;
                  const marginPct = p.mrp > 0 ? Math.round((margin / p.mrp) * 100) : 0;
                  const out = p.qty <= 0;
                  return (
                    <tr key={p.sku} className="border-t border-sand/60 hover:bg-cream/40">
                      <td className="p-3"><div className="flex items-center gap-3"><Img p={p} className="w-12 h-14 rounded-lg shrink-0" /><span className="text-ink font-medium">{p.name}<span className="block text-xs text-muted font-normal">{p.category}{p.colour ? ` · ${p.colour}` : ""}</span></span></div></td>
                      <td className="p-4 text-muted font-mono text-xs">{p.sku}</td>
                      <td className="p-4">{out ? <span className="text-muted">Out</span> : <span className={p.qty <= 3 ? "text-rose" : "text-emerald"}>{p.qty}</span>}</td>
                      <td className="p-4 text-right font-semibold text-emerald-dark whitespace-nowrap">{formatPaise(p.price)}</td>
                      <td className="p-4 text-right whitespace-nowrap"><span className="text-muted line-through">{formatPaise(p.mrp)}</span><span className="block text-[11px] text-gold-dark">+{formatPaise(margin)} ({marginPct}%)</span></td>
                      <td className="p-4 text-center">
                        <div className={`inline-flex items-center rounded-full border border-sand overflow-hidden ${out ? "opacity-40 pointer-events-none" : ""}`}>
                          <button onClick={() => addQty(p.sku, -1)} className="px-2.5 py-1 hover:bg-cream">−</button>
                          <QtyField value={n} min={0} onChange={(v) => setQtyAbs(p.sku, v)} className="w-14 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
                          <button onClick={() => addQty(p.sku, 1)} className="px-2.5 py-1 hover:bg-cream">+</button>
                        </div>
                        {n >= p.qty && p.qty > 0 && <p className="text-[10px] text-gold-dark mt-0.5">max stock</p>}
                      </td>
                      <td className="p-4 text-right font-medium">{n > 0 ? (() => {
                        const off = tierPctOff(sortedTiers, n);
                        return off > 0
                          ? <span>{formatPaise(applyTier(p.price, off) * n)}<span className="block text-[10px] text-emerald-dark">−{off}% bulk</span></span>
                          : formatPaise(p.price * n);
                      })() : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden space-y-2.5">
            {list.length === 0 && <p className="text-sm text-muted text-center py-6">No designs match.</p>}
            {list.map((p) => {
              const n = qty[p.sku] ?? 0;
              const margin = p.mrp - p.price;
              const marginPct = p.mrp > 0 ? Math.round((margin / p.mrp) * 100) : 0;
              const out = p.qty <= 0;
              return (
                <div key={p.sku} className="bg-white rounded-2xl border border-sand shadow-card p-3 flex gap-3">
                  <Img p={p} className="w-20 h-24 rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-ink font-medium leading-tight">{p.name}{p.colour ? <span className="text-emerald-dark"> · {p.colour}</span> : null}</p>
                    <p className="text-xs text-muted">{p.category} · <span className="font-mono">{p.sku}</span></p>
                    <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                      <span className="font-semibold text-emerald-dark">{formatPaise(p.price)}</span>
                      <span className="text-xs text-muted line-through">{formatPaise(p.mrp)}</span>
                      <span className="text-[11px] text-gold-dark">+{formatPaise(margin)} ({marginPct}%)</span>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs">{out ? <span className="text-muted">Out of stock</span> : <span className={p.qty <= 3 ? "text-rose" : "text-emerald"}>{p.qty} in stock</span>}</span>
                      <div className={`inline-flex items-center rounded-full border border-sand overflow-hidden ${out ? "opacity-40 pointer-events-none" : ""}`}>
                        <button onClick={() => addQty(p.sku, -1)} className="px-3 py-1.5 hover:bg-cream">−</button>
                        <QtyField value={n} min={0} onChange={(v) => setQtyAbs(p.sku, v)} className="w-12 text-center border-x border-sand py-1.5 outline-none focus:bg-emerald-mist" />
                        <button onClick={() => addQty(p.sku, 1)} className="px-3 py-1.5 hover:bg-cream">+</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Sticky order bar with ₹3,000 minimum progress */}
          <div className="sticky bottom-4 mt-4 bg-ink text-cream rounded-2xl shadow-luxe px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-cream/70 text-sm">{itemCount} pcs · {lines.length} design{lines.length === 1 ? "" : "s"}</span>
                <span className="ml-4 text-xl font-semibold text-ivory">{formatPaise(orderTotal)}</span>
                {savings > 0 && <span className="ml-3 text-sm text-emerald-light">saved {formatPaise(savings)}</span>}
                {err && <span className="ml-4 text-rose-light text-sm">{err}</span>}
              </div>
              <button onClick={goToPay} disabled={busy || lines.length === 0 || belowMin} className="btn-gold px-6 py-2.5 text-sm font-medium disabled:opacity-50">
                {belowMin ? `Add ${formatPaise(shortBy)} more` : "Review & pay →"}
              </button>
            </div>
            {belowMin && (
              <div className="mt-2">
                <div className="h-1.5 rounded-full bg-white/15 overflow-hidden"><div className="h-full bg-gold transition-all" style={{ width: `${Math.min(100, (orderTotal / minOrder) * 100)}%` }} /></div>
                <p className="text-[11px] text-cream/60 mt-1">₹3,000 minimum order — add {formatPaise(shortBy)} more to checkout.</p>
              </div>
            )}
          </div>
        </>
      )}

      {/* Payment step — scan the owner's UPI QR, pay, submit the reference. No Razorpay = owner keeps 100%. */}
      {paying && (
        <div className="fixed inset-0 z-[90] bg-ink/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => !busy && setPaying(false)}>
          <div className="bg-white rounded-2xl shadow-luxe w-full max-w-md max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-display text-2xl text-ink">Pay to confirm</h3>
                <p className="text-xs text-muted">{itemCount} pcs · {lines.length} design{lines.length === 1 ? "" : "s"}</p>
              </div>
              <button onClick={() => !busy && setPaying(false)} className="text-muted hover:text-ink text-lg leading-none">✕</button>
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl bg-cream/70 px-4 py-3">
              <span className="text-sm text-muted">Amount to pay{savings > 0 && <span className="block text-[11px] text-emerald-dark">incl. {formatPaise(savings)} bulk savings</span>}</span>
              <span className="text-2xl font-semibold text-ink">{formatPaise(orderTotal)}</span>
            </div>

            {payInfo && (payInfo.qrUrl || payInfo.upiId) ? (
              <div className="mt-4 text-center">
                <p className="text-sm text-ink font-medium">Scan &amp; pay in any UPI app</p>
                {payInfo.qrUrl
                  ? <img src={payInfo.qrUrl} alt="UPI QR" className="mx-auto mt-2 w-56 h-56 object-contain rounded-xl border border-sand bg-white" />
                  : <div className="mx-auto mt-2 w-56 h-56 rounded-xl border border-dashed border-sand grid place-items-center text-xs text-muted p-4">QR will be added soon — use the UPI ID below.</div>}
                {payInfo.upiId && <p className="mt-2 text-sm text-ink">UPI ID: <b className="font-mono">{payInfo.upiId}</b></p>}
                <p className="text-[11px] text-muted mt-1">Pay to {payInfo.payeeName}. Then enter the UPI reference below.</p>
              </div>
            ) : (
              <p className="mt-4 text-sm text-gold-dark bg-gold/10 rounded-xl px-4 py-3">Payment details will be shared with you on WhatsApp right after you place the order. You can add the UPI reference now or later.</p>
            )}

            <label className="block text-xs font-medium text-muted mt-4 mb-1">UPI transaction reference (UTR) <span className="text-muted/70">— optional, speeds up verification</span></label>
            <input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="e.g. 4351xxxxxxxx" className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-emerald" />
            {err && <p className="text-sm text-rose mt-2">{err}</p>}

            <div className="flex items-center gap-2 mt-4">
              <button onClick={confirmOrder} disabled={busy} className="btn-gold flex-1 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Placing…" : "I've paid — place order"}</button>
              <button onClick={() => !busy && setPaying(false)} className="px-4 py-2.5 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Back</button>
            </div>
            <p className="text-[11px] text-muted mt-2 text-center">We verify your payment and dispatch — you'll get a WhatsApp confirmation.</p>
          </div>
        </div>
      )}

      {/* Request-a-quote: bulk / custom orders → stored + WhatsApp to owner for a price. */}
      {rfqOpen && (
        <div className="fixed inset-0 z-[90] bg-ink/60 backdrop-blur-sm grid place-items-center p-4" onClick={() => !rfqBusy && setRfqOpen(false)}>
          <div className="bg-white rounded-2xl shadow-luxe w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            {rfqDone ? (
              <div className="text-center py-4">
                <p className="text-4xl mb-2">✓</p>
                <h3 className="font-display text-2xl text-ink">Request sent</h3>
                <p className="text-sm text-muted mt-1">We&apos;ll get back to you on WhatsApp with a trade price shortly.</p>
                <button onClick={() => setRfqOpen(false)} className="btn-primary px-6 py-2.5 text-sm font-medium mt-4">Done</button>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-display text-2xl text-ink">Request a quote</h3>
                    <p className="text-xs text-muted">For bulk, mixed-lot or custom orders — tell us what you need.</p>
                  </div>
                  <button onClick={() => !rfqBusy && setRfqOpen(false)} className="text-muted hover:text-ink text-lg leading-none">✕</button>
                </div>
                <textarea value={rfqText} onChange={(e) => setRfqText(e.target.value)} rows={5}
                  placeholder={"e.g. 200 pcs mixed jhumkas, gold-tone, need by Diwali — best rate?"}
                  className="w-full rounded-xl border border-sand px-3 py-2.5 text-sm outline-none focus:border-emerald mt-3" />
                {rfqErr && <p className="text-sm text-rose mt-2">{rfqErr}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <button onClick={submitQuote} disabled={rfqBusy || rfqText.trim().length < 5} className="btn-gold flex-1 py-2.5 text-sm font-medium disabled:opacity-50">{rfqBusy ? "Sending…" : "Send request"}</button>
                  <button onClick={() => !rfqBusy && setRfqOpen(false)} className="px-4 py-2.5 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Image enlarge */}
      {zoom && (
        <div className="fixed inset-0 z-[100] bg-ink/90 backdrop-blur-sm grid place-items-center p-5" onClick={() => setZoom(null)}>
          <button onClick={() => setZoom(null)} className="absolute top-4 right-5 text-cream/80 hover:text-white text-3xl">✕</button>
          <img src={zoom.src} alt={zoom.name} className="max-w-[92vw] max-h-[85vh] object-contain rounded-xl" onClick={(e) => e.stopPropagation()} />
          <p className="absolute bottom-5 left-0 right-0 text-center text-cream/70 text-sm">{zoom.name}</p>
        </div>
      )}
    </div>
  );
}
