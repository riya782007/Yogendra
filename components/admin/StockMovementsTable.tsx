"use client";
/**
 * StockMovementsTable — the Stock Movement register table, now with click-to-open Product Stock
 * Ledger. Clicking any row opens the right-side drawer for that SKU WITHOUT leaving the page.
 * (Document links inside a row still navigate, via stopPropagation.)
 */
import { useState } from "react";
import Link from "next/link";
import { StockLedgerDrawer } from "./StockLedgerDrawer";

type Row = {
  id: string; product_id: string | null; kind: string | null; delta: number;
  sku: string | null; source: string | null; reason: string | null; ref_id: string | null;
  created_at: string; invoice_no?: string | null; party?: string | null;
  product?: { sku: string; name: string } | null; variant?: { color: string } | null;
};

const KIND_STYLE: Record<string, string> = {
  sale: "bg-gold/15 text-gold-dark", purchase: "bg-emerald-mist text-emerald-dark",
  damage: "bg-rose/10 text-rose", opening: "bg-blue-100 text-blue-700",
  adjustment: "bg-cream text-muted", estimate: "bg-gold/10 text-gold-dark",
};

function docFor(r: Row): { href: string; label: string } | null {
  if (!r.ref_id) return null;
  if (r.kind === "sale") return { href: `/admin/invoice/${r.ref_id}`, label: "View bill →" };
  if (r.kind === "purchase") return { href: `/admin/purchase/${r.ref_id}`, label: "View purchase →" };
  if (r.kind === "estimate") return { href: `/admin/estimate/${r.ref_id}`, label: "View estimate →" };
  return null;
}

export function StockMovementsTable({ rows }: { rows: Row[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Date</th><th className="p-3">Item</th><th className="p-3">Party</th><th className="p-3">Type</th>
            <th className="p-3 text-right">Change</th><th className="p-3">Note</th><th className="p-3">Document</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="p-4 text-muted">No movements match these filters.</td></tr>}
            {rows.map((r) => {
              const doc = docFor(r);
              const colour = r.variant?.color;
              return (
                <tr
                  key={r.id}
                  onClick={() => r.product_id && setOpenId(r.product_id)}
                  className={`border-t border-sand/60 hover:bg-cream/40 ${r.product_id ? "cursor-pointer" : ""}`}
                  title={r.product_id ? "Open full stock ledger for this SKU" : undefined}
                >
                  <td className="p-3 text-muted whitespace-nowrap">{new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="p-3 text-ink">
                    {r.product?.name ?? "—"}
                    <span className="block text-xs text-muted">{r.sku ?? r.product?.sku}{colour ? ` · ${colour}` : ""}</span>
                  </td>
                  <td className="p-3 text-ink">{r.party ? <span>{r.party}</span> : <span className="text-muted">—</span>}</td>
                  <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${KIND_STYLE[r.kind ?? ""] ?? "bg-cream text-muted"}`}>{r.kind ?? "—"}</span></td>
                  <td className={`p-3 text-right font-semibold tabular-nums ${r.delta > 0 ? "text-emerald-dark" : "text-rose"}`}>{r.delta > 0 ? "+" : ""}{r.delta}</td>
                  <td className="p-3 text-muted max-w-[260px] truncate">{r.source ?? ""}{r.reason ? ` — ${r.reason}` : ""}</td>
                  <td className="p-3" onClick={(e) => e.stopPropagation()}>{doc ? (
                    <div className="whitespace-nowrap">
                      {r.kind === "sale" && <span className="block text-[11px] font-medium text-ink">{r.invoice_no || `INV-${String(r.ref_id).slice(0, 8).toUpperCase()}`}</span>}
                      <Link href={doc.href} className="text-emerald nav-link text-xs">{doc.label}</Link>
                    </div>
                  ) : <span className="text-muted text-xs">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {openId && <StockLedgerDrawer productId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
