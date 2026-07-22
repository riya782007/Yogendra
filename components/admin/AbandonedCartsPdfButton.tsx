"use client";
import { formatPaise } from "@/lib/pricing";

type Item = { sku?: string; name?: string; qty?: number; price?: number; color?: string; label?: string };
type Cart = {
  id: string; customer_name?: string | null; phone?: string | null; city?: string | null;
  channel?: string | null; total?: number | null; updated_at?: string | null;
  reached_checkout?: boolean | null; items?: Item[] | null;
};

/** Download all abandoned carts as a clean PDF (print → Save as PDF). Nothing important is dropped:
 *  customer name, phone, city, channel, every item's SKU/colour/qty/price, total and last-active time. */
export function AbandonedCartsPdfButton({ carts }: { carts: Cart[] }) {
  const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
  const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

  const download = () => {
    const recoverable = carts.reduce((s, c) => s + (c.total ?? 0), 0);
    const blocks = carts.map((c, i) => {
      const items = (c.items ?? []).map((it) => `
        <tr>
          <td class="sku">${esc(it.sku ?? "")}</td>
          <td>${esc(it.name ?? "")}${it.color || it.label ? ` — ${esc(it.color ?? it.label)}` : ""}</td>
          <td class="r">${esc(it.qty ?? 1)}</td>
          <td class="r">${it.price != null ? esc(formatPaise(it.price)) : ""}</td>
        </tr>`).join("");
      return `
        <div class="cart">
          <div class="head">
            <div><span class="n">#${i + 1}</span> <b>${esc(c.customer_name || "Unknown shopper")}</b>
              <span class="tag ${c.channel === "wholesale" ? "w" : "r2"}">${esc((c.channel || "retail").toUpperCase())}</span>
              ${c.reached_checkout ? `<span class="tag chk">REACHED CHECKOUT</span>` : ""}
            </div>
            <div class="total">${c.total != null ? esc(formatPaise(c.total)) : ""}</div>
          </div>
          <div class="meta">
            📞 ${esc(c.phone || "—")} &nbsp;·&nbsp; 📍 ${esc(c.city || "—")} &nbsp;·&nbsp; 🕑 ${esc(dt(c.updated_at))}
          </div>
          <table class="items"><thead><tr><th>SKU</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th></tr></thead>
            <tbody>${items || `<tr><td colspan="4" class="muted">No item detail</td></tr>`}</tbody></table>
        </div>`;
    }).join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Abandoned Carts — BlytheDIVA</title><style>
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 24px; }
      h1 { font-size: 20px; margin: 0 0 2px; }
      .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
      .cart { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; page-break-inside: avoid; }
      .head { display: flex; justify-content: space-between; align-items: center; }
      .n { color: #999; font-weight: 700; }
      .total { font-weight: 700; font-size: 15px; }
      .tag { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 10px; margin-left: 6px; vertical-align: middle; }
      .w { background: #e7f0ff; color: #1447c9; } .r2 { background: #eee; color: #555; } .chk { background: #fde8e8; color: #c0392b; }
      .meta { color: #555; font-size: 12px; margin: 4px 0 6px; }
      table.items { width: 100%; border-collapse: collapse; font-size: 11px; }
      table.items th { text-align: left; color: #888; border-bottom: 1px solid #eee; padding: 2px 4px; font-weight: 600; }
      table.items td { padding: 3px 4px; border-bottom: 1px solid #f3f3f3; }
      .sku { font-family: 'Courier New', monospace; font-weight: 700; }
      .r { text-align: right; } .muted { color: #999; }
      @media print { body { margin: 12mm; } }
    </style></head><body>
      <h1>Abandoned Carts — BlytheDIVA</h1>
      <div class="sub">${carts.length} cart${carts.length === 1 ? "" : "s"} · ${formatPaise(recoverable)} recoverable · generated ${esc(dt(new Date().toISOString()))}</div>
      ${blocks || `<p class="muted">No abandoned carts.</p>`}
    </body></html>`;

    const f = document.createElement("iframe");
    f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
    document.body.appendChild(f);
    const d = f.contentDocument, w = f.contentWindow;
    if (!d || !w) { document.body.removeChild(f); return; }
    d.open(); d.write(html); d.close();
    w.focus(); setTimeout(() => { w.print(); }, 250);
    setTimeout(() => { try { document.body.removeChild(f); } catch {} }, 60_000);
  };

  return (
    <button onClick={download}
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald text-emerald px-4 py-2 text-sm font-medium hover:bg-emerald-mist">
      ⬇ Download PDF
    </button>
  );
}
