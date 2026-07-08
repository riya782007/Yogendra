"use client";
/**
 * ProductHistoryLedger — the movement history embedded in the product 360's History tab.
 * Shows EVERY movement for this product — sales, purchases, adjustments AND estimates —
 * each with date, party name, variant colour, quantity, unit price and a link to its
 * document (invoice / purchase / estimate). Data comes from the same fetchProductLedgerAction
 * that powers the Stock Ledger drawer, so both views always agree.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchProductLedgerAction } from "@/app/actions/ledger";
import { StockLedgerDrawer } from "./StockLedgerDrawer";

const KIND_STYLE: Record<string, string> = {
  sale: "bg-gold/15 text-gold-dark", purchase: "bg-emerald-mist text-emerald-dark",
  damage: "bg-rose/10 text-rose", opening: "bg-blue-100 text-blue-700",
  adjustment: "bg-cream text-muted", estimate: "bg-gold/10 text-gold-dark",
  return: "bg-blue-50 text-blue-700",
};

const fmt = (paise?: number | null) => paise == null ? null : `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });

export function ProductHistoryLedger({ productId }: { productId: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchProductLedgerAction(productId, { offset: 0, limit: 40 }).then((d) => {
      if (alive) { setData(d); setLoading(false); }
    }).catch(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [productId]);

  if (loading) return <p className="text-sm text-muted py-4">Loading movement history…</p>;
  if (!data) return <p className="text-sm text-muted py-4">No movement history available.</p>;

  const rows: any[] = data.movements ?? [];
  const h = data.header;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          Stock, sales &amp; estimate history
          <span className="text-muted font-normal"> — stock {h?.currentStock ?? "—"}{h?.reserved ? ` · ${h.reserved} reserved by open estimates` : ""}{h?.lastPurchaseCost != null ? ` · last cost ${fmt(h.lastPurchaseCost)}` : ""}</span>
        </p>
        <button onClick={() => setDrawer(true)} className="text-xs px-3 py-1.5 rounded-full border border-sand text-ink hover:border-emerald">
          Open full ledger →
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No stock movements or estimates recorded for this product yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-sand bg-white">
          <table className="w-full text-sm">
            <thead className="bg-cream text-muted text-left"><tr>
              <th className="p-2.5">Date</th><th className="p-2.5">Type</th><th className="p-2.5">Party</th>
              <th className="p-2.5">Variant</th><th className="p-2.5 text-right">Qty</th>
              <th className="p-2.5 text-right">Price</th><th className="p-2.5">Bill / Document</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-sand/60">
                  <td className="p-2.5 text-muted whitespace-nowrap">{when(r.created_at)}</td>
                  <td className="p-2.5"><span className={`px-2 py-0.5 rounded-full text-[10px] capitalize ${KIND_STYLE[r.kind] ?? "bg-cream text-muted"}`}>{r.hold ? "estimate ⏳" : r.kind}</span></td>
                  <td className="p-2.5 text-ink">{r.party ?? <span className="text-muted">—</span>}</td>
                  <td className="p-2.5 text-ink">{r.variant?.color ?? <span className="text-muted">—</span>}</td>
                  <td className={`p-2.5 text-right font-semibold tabular-nums ${r.hold ? "text-gold-dark" : r.delta > 0 ? "text-emerald-dark" : "text-rose"}`}>{r.hold ? `⏳ ${Math.abs(r.delta)}` : `${r.delta > 0 ? "+" : ""}${r.delta}`}</td>
                  <td className="p-2.5 text-right tabular-nums" title={r.kind === "purchase" ? "Unit cost" : "Unit rate billed"}>{fmt(r.price) ?? <span className="text-muted">—</span>}</td>
                  <td className="p-2.5 whitespace-nowrap">
                    {r.invoice_no && <span className="block text-[11px] font-medium text-ink">{r.invoice_no}</span>}
                    {r.doc ? <Link href={r.doc.href} className="text-emerald nav-link text-xs">{r.doc.label}</Link> : <span className="text-muted text-xs">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {drawer && <StockLedgerDrawer productId={productId} onClose={() => setDrawer(false)} />}
    </div>
  );
}
