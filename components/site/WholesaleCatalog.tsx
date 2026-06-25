"use client";
import { useState, useMemo } from "react";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { QtyField } from "@/components/admin/QtyField";
import { placeWholesaleOrderAction, wholesaleLogoutAction } from "@/app/actions/wholesale";

type P = { sku: string; name: string; category: string; qty: number; price: number; mrp: number; image: string | null };
type HistItem = { sku: string; name: string; qty: number };
type Hist = { id: string; total: number; created_at: string; invoice_no: string | null; items: HistItem[] };

export function WholesaleCatalog({ products, customerName, minOrder = 300000, history = [] }: {
  products: P[]; customerName: string; minOrder?: number; history?: Hist[];
}) {
  const [q, setQ] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; total: number } | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState<"order" | "history">("order");
  const [bulk, setBulk] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");

  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.toUpperCase(), p])), [products]);
  const list = useMemo(() => q.trim() ? products.filter((p) => (p.name + p.sku + p.category).toLowerCase().includes(q.toLowerCase())) : products, [q, products]);
  const lines = Object.entries(qty).filter(([, n]) => n > 0);
  const orderTotal = lines.reduce((s, [sku, n]) => s + (bySku.get(sku.toUpperCase())?.price ?? 0) * n, 0);
  const itemCount = lines.reduce((s, [, n]) => s + n, 0);
  const belowMin = orderTotal > 0 && orderTotal < minOrder;
  const shortBy = Math.max(0, minOrder - orderTotal);

  function addQty(sku: string, n: number) { setQty((s) => ({ ...s, [sku]: Math.max(0, (s[sku] ?? 0) + n) })); }
  function setQtyAbs(sku: string, n: number) { setQty((s) => ({ ...s, [sku]: Math.max(0, n) })); }

  async function place() {
    if (lines.length === 0) return;
    setBusy(true); setErr("");
    const res = await placeWholesaleOrderAction(lines.map(([sku, n]) => ({ sku, qty: n })));
    setBusy(false);
    if (res.ok) { setDone({ id: res.orderId!, total: res.total ?? 0 }); setQty({}); }
    else setErr(res.error ?? "Could not place order");
  }

  /** Quick order — paste "SKU qty" lines (or "SKU x qty", commas, etc.). */
  function applyBulk() {
    let added = 0, missed = 0;
    const next = { ...qty };
    bulk.split(/[\n;]+/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const m = line.match(/([A-Za-z0-9-]+)\D+(\d+)/);
      if (!m) { missed++; return; }
      const p = bySku.get(m[1].toUpperCase());
      if (!p) { missed++; return; }
      next[p.sku] = (next[p.sku] ?? 0) + parseInt(m[2], 10); added++;
    });
    setQty(next);
    setBulkMsg(`${added} line${added === 1 ? "" : "s"} added${missed ? ` · ${missed} not recognised` : ""}.`);
    setBulk("");
  }

  function reorder(h: Hist) {
    const next = { ...qty };
    let ok = 0, gone = 0;
    h.items.forEach((it) => { if (bySku.has(it.sku.toUpperCase())) { next[it.sku] = (next[it.sku] ?? 0) + it.qty; ok++; } else gone++; });
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
          <form action={wholesaleLogoutAction}><button className="text-sm text-muted hover:text-ink">Sign out</button></form>
        </div>
      </div>

      {tab === "history" ? (
        <div className="space-y-3">
          {history.length === 0 && <p className="text-sm text-muted bg-white rounded-2xl border border-sand p-6 text-center">No past orders yet — place your first below.</p>}
          {history.map((h) => (
            <div key={h.id} className="bg-white rounded-2xl border border-sand shadow-card p-5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{h.invoice_no || h.id.slice(0, 8).toUpperCase()} <span className="text-xs text-muted">· {new Date(h.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })}</span></p>
                <p className="text-sm text-muted truncate">{h.items.map((i) => `${i.name} ×${i.qty}`).join(", ") || "—"}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-semibold text-ink">{formatPaise(h.total)}</p>
                <button onClick={() => reorder(h)} className="text-xs text-emerald nav-link">↻ Reorder these</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          {/* Search + quick order */}
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search designs…" className="rounded-full border border-sand px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[180px]" />
            <details className="relative">
              <summary className="cursor-pointer list-none px-4 py-2 rounded-full border border-sand text-sm text-ink hover:border-gold">⚡ Quick order (paste list)</summary>
              <div className="absolute right-0 z-20 mt-2 w-80 bg-white rounded-2xl shadow-luxe border border-sand p-3">
                <p className="text-xs text-muted mb-2">Paste one per line: <code className="bg-cream px-1 rounded">SKU qty</code> (e.g. <code className="bg-cream px-1 rounded">BD1001 12</code>).</p>
                <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} rows={5} className="w-full rounded-xl border border-sand px-3 py-2 text-sm font-mono outline-none focus:border-emerald" placeholder={"BD1001 12\nBD1002 6"} />
                <button onClick={applyBulk} className="btn-primary w-full mt-2 py-2 text-sm font-medium">Add to order</button>
              </div>
            </details>
          </div>
          {bulkMsg && <p className="text-xs text-emerald-dark mb-2">{bulkMsg}</p>}

          <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
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
                  return (
                    <tr key={p.sku} className="border-t border-sand/60 hover:bg-cream/40">
                      <td className="p-3"><div className="flex items-center gap-3"><div className="w-12 h-14 rounded-lg overflow-hidden bg-cream shrink-0">{p.image ? <img src={p.image} alt={p.name} className="w-full h-full object-cover" /> : <ProductImage name={p.name} />}</div><span className="text-ink font-medium">{p.name}<span className="block text-xs text-muted font-normal">{p.category}</span></span></div></td>
                      <td className="p-4 text-muted font-mono text-xs">{p.sku}</td>
                      <td className="p-4">{p.qty > 0 ? <span className={p.qty <= 3 ? "text-rose" : "text-emerald"}>{p.qty}</span> : <span className="text-muted">Out</span>}</td>
                      <td className="p-4 text-right font-semibold text-emerald-dark whitespace-nowrap">{formatPaise(p.price)}</td>
                      <td className="p-4 text-right whitespace-nowrap"><span className="text-muted line-through">{formatPaise(p.mrp)}</span><span className="block text-[11px] text-gold-dark">+{formatPaise(margin)} ({marginPct}%)</span></td>
                      <td className="p-4 text-center">
                        <div className="inline-flex items-center rounded-full border border-sand overflow-hidden">
                          <button onClick={() => addQty(p.sku, -1)} className="px-2.5 py-1 hover:bg-cream">−</button>
                          <QtyField value={n} min={0} onChange={(v) => setQtyAbs(p.sku, v)} className="w-14 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
                          <button onClick={() => addQty(p.sku, 1)} className="px-2.5 py-1 hover:bg-cream">+</button>
                        </div>
                      </td>
                      <td className="p-4 text-right font-medium">{n > 0 ? formatPaise(p.price * n) : <span className="text-muted">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Sticky order bar with ₹3,000 minimum progress */}
          <div className="sticky bottom-4 mt-4 bg-ink text-cream rounded-2xl shadow-luxe px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="text-cream/70 text-sm">{itemCount} pcs · {lines.length} design{lines.length === 1 ? "" : "s"}</span>
                <span className="ml-4 text-xl font-semibold text-ivory">{formatPaise(orderTotal)}</span>
                {err && <span className="ml-4 text-rose-light text-sm">{err}</span>}
              </div>
              <button onClick={place} disabled={busy || lines.length === 0 || belowMin} className="btn-gold px-6 py-2.5 text-sm font-medium disabled:opacity-50">
                {busy ? "Placing…" : belowMin ? `Add ${formatPaise(shortBy)} more` : "Place wholesale order"}
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
    </div>
  );
}
