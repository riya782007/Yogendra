import { formatPaise } from "@/lib/pricing";

export type PdfCartItem = { sku?: string; name?: string; qty?: number; price?: number; color?: string; label?: string };
export type PdfCart = {
  id: string; customer_name?: string | null; phone?: string | null; city?: string | null;
  channel?: string | null; total?: number | null; updated_at?: string | null; created_at?: string | null;
  reached_checkout?: boolean | null; items?: PdfCartItem[] | null;
};

const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Build + open a print-ready PDF for ONE or MANY abandoned carts (print → Save as PDF).
 * Each cart is its own block, matching what the owner sees on screen: customer name + phone + city,
 * channel + reached-payment flags, and every item's thumbnail, SKU, colour, qty, unit price and line
 * total — plus the cart total and when it was abandoned. Guests are clearly marked "No contact captured".
 */
export function openAbandonedCartsPdf(carts: PdfCart[], opts?: { imgMap?: Record<string, string>; title?: string }) {
  const imgMap = opts?.imgMap ?? {};
  const one = carts.length === 1;
  const title = opts?.title ?? (one ? "Abandoned Cart" : "Abandoned Carts");
  const recoverable = carts.reduce((s, c) => s + (c.total ?? 0), 0);

  const blocks = carts.map((c, i) => {
    const when = c.updated_at ?? c.created_at ?? null;
    const items = (c.items ?? []).map((it) => {
      const thumb = it.sku && imgMap[it.sku] ? `<img class="th" src="${esc(imgMap[it.sku])}" />` : `<span class="th ph"></span>`;
      const line = (it.price != null) ? formatPaise((it.price || 0) * (Number(it.qty) || 1)) : "";
      return `
        <tr>
          <td class="tc">${thumb}</td>
          <td class="sku">${esc(it.sku ?? "")}</td>
          <td>${esc(it.name ?? "")}${it.color || it.label ? ` — ${esc(it.color ?? it.label)}` : ""}</td>
          <td class="r">${esc(it.qty ?? 1)}</td>
          <td class="r">${it.price != null ? esc(formatPaise(it.price)) : ""}</td>
          <td class="r">${esc(line)}</td>
        </tr>`;
    }).join("");
    return `
      <div class="cart">
        <div class="head">
          <div><span class="n">#${i + 1}</span> <b>${esc(c.customer_name || "No contact captured")}</b>
            <span class="tag ${c.channel === "wholesale" ? "w" : "r2"}">${esc((c.channel || "retail").toUpperCase())}</span>
            ${c.reached_checkout ? `<span class="tag chk">REACHED PAYMENT</span>` : ""}
          </div>
          <div class="total">${c.total != null ? esc(formatPaise(c.total)) : ""}</div>
        </div>
        <div class="meta">
          📞 ${esc(c.phone || "Not captured")} &nbsp;·&nbsp; 📍 ${esc(c.city || "—")} &nbsp;·&nbsp; 🕑 ${esc(dt(when))}
        </div>
        <table class="items"><thead><tr><th></th><th>SKU</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Line</th></tr></thead>
          <tbody>${items || `<tr><td colspan="6" class="muted">No item detail</td></tr>`}</tbody></table>
      </div>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — BlytheDIVA</title><style>
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
    table.items td { padding: 3px 4px; border-bottom: 1px solid #f3f3f3; vertical-align: middle; }
    .tc { width: 40px; }
    .th { width: 34px; height: 34px; object-fit: cover; border-radius: 4px; display: inline-block; background: #f3f3f3; border: 1px solid #eee; }
    .th.ph { }
    .sku { font-family: 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
    .r { text-align: right; } .muted { color: #999; }
    .bar { position: sticky; top: 0; background: #fff; padding: 8px 0 12px; margin-bottom: 6px; border-bottom: 1px solid #eee; }
    .bar button { font: 600 13px Arial; background: #0f766e; color: #fff; border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer; }
    @media print { body { margin: 12mm; } .bar { display: none; } }
  </style></head><body>
    <div class="bar"><button onclick="window.print()">⬇ Save as PDF</button></div>
    <h1>${esc(title)} — BlytheDIVA</h1>
    <div class="sub">${carts.length} cart${carts.length === 1 ? "" : "s"} · ${formatPaise(recoverable)} recoverable · generated ${esc(dt(new Date().toISOString()))}</div>
    ${blocks || `<p class="muted">No abandoned carts.</p>`}
    <script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},400);});<\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups for this site, then click Download PDF again."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
