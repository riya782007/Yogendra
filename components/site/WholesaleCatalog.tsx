"use client";
import { useState, useMemo } from "react";
import { formatPaise } from "@/lib/pricing";
import { ProductImage } from "@/components/Placeholder";
import { QtyField } from "@/components/admin/QtyField";
import { placeWholesaleOrderAction } from "@/app/actions/wholesale";
import { wholesaleLogoutAction } from "@/app/actions/wholesale";

type P = { sku: string; name: string; category: string; qty: number; price: number };

export function WholesaleCatalog({ products, customerName }: { products: P[]; customerName: string }) {
  const [q, setQ] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string; total: number } | null>(null);
  const [err, setErr] = useState("");

  const list = useMemo(() => q.trim() ? products.filter((p) => (p.name + p.sku + p.category).toLowerCase().includes(q.toLowerCase())) : products, [q, products]);
  const lines = Object.entries(qty).filter(([, n]) => n > 0);
  const orderTotal = lines.reduce((s, [sku, n]) => s + (products.find((p) => p.sku === sku)?.price ?? 0) * n, 0);
  const itemCount = lines.reduce((s, [, n]) => s + n, 0);

  async function place() {
    setBusy(true); setErr("");
    const res = await placeWholesaleOrderAction(lines.map(([sku, n]) => ({ sku, qty: n })));
    setBusy(false);
    if (res.ok) { setDone({ id: res.orderId!, total: res.total ?? 0 }); setQty({}); }
    else setErr(res.error ?? "Could not place order");
  }

  if (done) {
    return (
      <div className="rounded-3xl bg-white border border-sand shadow-card p-10 text-center max-w-lg mx-auto">
        <p className="text-5xl mb-3">✓</p>
        <h2 className="font-display text-3xl text-ink">Order placed</h2>
        <p className="text-muted mt-2">Wholesale order <b className="text-ink">{done.id.slice(0, 8).toUpperCase()}</b> for <b className="text-emerald">{formatPaise(done.total)}</b> is in. We'll be in touch to confirm dispatch.</p>
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search designs…" className="rounded-full border border-sand px-4 py-2 text-sm outline-none focus:border-emerald" />
          <form action={wholesaleLogoutAction}><button className="text-sm text-muted hover:text-ink">Sign out</button></form>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-4">Design</th><th className="p-4">SKU</th><th className="p-4">Category</th><th className="p-4">Stock</th>
            <th className="p-4 text-right">Wholesale rate</th><th className="p-4 text-center">Qty</th><th className="p-4 text-right">Line total</th>
          </tr></thead>
          <tbody>
            {list.map((p) => {
              const n = qty[p.sku] ?? 0;
              return (
                <tr key={p.sku} className="border-t border-sand/60 hover:bg-cream/40">
                  <td className="p-3"><div className="flex items-center gap-3"><div className="w-11 h-13 rounded-lg overflow-hidden"><ProductImage name={p.name} /></div><span className="text-ink font-medium">{p.name}</span></div></td>
                  <td className="p-4 text-muted">{p.sku}</td>
                  <td className="p-4 text-muted">{p.category}</td>
                  <td className="p-4">{p.qty > 0 ? <span className={p.qty <= 3 ? "text-rose" : "text-emerald"}>{p.qty} pcs</span> : <span className="text-muted">Out</span>}</td>
                  <td className="p-4 text-right font-semibold text-emerald-dark">{formatPaise(p.price)}</td>
                  <td className="p-4 text-center">
                    <div className="inline-flex items-center rounded-full border border-sand overflow-hidden">
                      <button onClick={() => setQty((s) => ({ ...s, [p.sku]: Math.max(0, (s[p.sku] ?? 0) - 1) }))} className="px-2.5 py-1 hover:bg-cream">−</button>
                      <QtyField value={n} min={0} onChange={(v) => setQty((s) => ({ ...s, [p.sku]: v }))} className="w-14 text-center border-x border-sand py-1 outline-none focus:bg-emerald-mist" />
                      <button onClick={() => setQty((s) => ({ ...s, [p.sku]: (s[p.sku] ?? 0) + 1 }))} className="px-2.5 py-1 hover:bg-cream">+</button>
                    </div>
                  </td>
                  <td className="p-4 text-right font-medium">{n > 0 ? formatPaise(p.price * n) : <span className="text-muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Sticky order bar */}
      <div className="sticky bottom-4 mt-4 bg-ink text-cream rounded-2xl shadow-luxe px-5 py-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-cream/70 text-sm">{itemCount} pcs · {lines.length} design{lines.length === 1 ? "" : "s"}</span>
          <span className="ml-4 text-xl font-semibold text-ivory">{formatPaise(orderTotal)}</span>
          {err && <span className="ml-4 text-rose-light text-sm">{err}</span>}
        </div>
        <button onClick={place} disabled={busy || lines.length === 0} className="btn-gold px-6 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Placing…" : "Place wholesale order"}</button>
      </div>
    </div>
  );
}
