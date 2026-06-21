"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/pricing";
import { posSaleAction } from "@/app/actions/orders";

type P = { sku: string; name: string; price: number; category: string; qty: number };

export function POSClient({ products }: { products: P[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [lines, setLines] = useState<{ sku: string; name: string; price: number; qty: number }[]>([]);
  const [cust, setCust] = useState({ name: "", phone: "" });
  const [pay, setPay] = useState("cash");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const matches = useMemo(() => {
    if (!q.trim()) return [];
    const s = q.toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s)).slice(0, 6);
  }, [q, products]);

  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  function addLine(p: P) { setLines((prev) => { const ex = prev.find((l) => l.sku === p.sku); if (ex) return prev.map((l) => l.sku === p.sku ? { ...l, qty: l.qty + 1 } : l); return [...prev, { sku: p.sku, name: p.name, price: p.price, qty: 1 }]; }); setQ(""); }
  function setQty(sku: string, qty: number) { setLines((p) => p.map((l) => l.sku === sku ? { ...l, qty: Math.max(1, qty) } : l)); }
  function rm(sku: string) { setLines((p) => p.filter((l) => l.sku !== sku)); }

  async function complete() {
    setBusy(true); setErr("");
    const res = await posSaleAction({ items: lines.map((l) => ({ sku: l.sku, qty: l.qty })), customer: cust, payment: pay });
    setBusy(false);
    if (!res.ok) { setErr(res.error ?? "Failed"); return; }
    router.push(`/admin/invoice/${res.orderId}`);
  }

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald";
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-2xl p-6 shadow-card">
        <h2 className="font-medium text-ink mb-3">Add items</h2>
        <div className="relative">
          <input className={input} placeholder="Search by name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
              {matches.map((p) => (
                <button key={p.sku} onClick={() => addLine(p)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-mist flex justify-between">
                  <span>{p.name} <span className="text-muted">· {p.sku}</span></span><span className="text-ink">{formatPaise(p.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 space-y-2">
          {lines.length === 0 && <p className="text-sm text-muted">No items yet. Search above to add.</p>}
          {lines.map((l) => (
            <div key={l.sku} className="flex items-center gap-3 border-b border-sand/60 pb-2">
              <div className="flex-1"><p className="text-sm text-ink">{l.name}</p><p className="text-xs text-muted">{l.sku} · {formatPaise(l.price)}</p></div>
              <div className="inline-flex items-center rounded-full border border-sand text-sm">
                <button onClick={() => setQty(l.sku, l.qty - 1)} className="px-2">−</button><span className="px-2">{l.qty}</span><button onClick={() => setQty(l.sku, l.qty + 1)} className="px-2">+</button>
              </div>
              <span className="text-sm font-medium w-20 text-right">{formatPaise(l.price * l.qty)}</span>
              <button onClick={() => rm(l.sku)} className="text-muted hover:text-rose text-xs">✕</button>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-card h-fit">
        <h2 className="font-medium text-ink mb-3">Customer &amp; payment</h2>
        <div className="space-y-3">
          <input className={input} placeholder="Customer name (optional)" value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} />
          <input className={input} placeholder="Phone (optional)" value={cust.phone} onChange={(e) => setCust({ ...cust, phone: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            {["cash", "upi", "card"].map((p) => (
              <button key={p} onClick={() => setPay(p)} className={`rounded-xl border px-3 py-2 text-sm capitalize transition-all ${pay === p ? "border-emerald bg-emerald-mist text-emerald" : "border-sand text-muted hover:border-gold"}`}>{p}</button>
            ))}
          </div>
        </div>
        <div className="mt-5 border-t border-sand pt-4 flex justify-between items-baseline">
          <span className="text-muted">Total</span><span className="text-3xl font-semibold text-ink">{formatPaise(total)}</span>
        </div>
        {err && <p className="text-sm text-rose mt-2">{err}</p>}
        <button onClick={complete} disabled={busy || lines.length === 0} className="btn-primary w-full mt-4 py-3.5 text-sm font-medium disabled:opacity-50">
          {busy ? "Completing…" : "Complete sale & print bill"}
        </button>
      </div>
    </div>
  );
}
