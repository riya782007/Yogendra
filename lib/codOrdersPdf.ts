import { formatPaise } from "@/lib/pricing";

export type PdfCodItem = { sku?: string; name?: string; qty?: number; price?: number; color?: string };
export type PdfCodOrder = {
  id: string;
  invoice_no?: string | null;
  channel?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  buyer_address?: string | null;
  total?: number | null;
  created_at?: string | null;
  items?: PdfCodItem[] | null;
};

const esc = (s: any) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const dt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/**
 * Print-ready PDF for one or many COD orders (print → Save as PDF).
 * Same shape as abandoned-cart PDFs: customer + phone + ship-to, invoice, channel, every
 * line's photo / SKU / colour / qty / rate / line total, and the amount to collect on delivery.
 */
export function openCodOrdersPdf(orders: PdfCodOrder[], opts?: { imgMap?: Record<string, string>; title?: string }) {
  const imgMap = opts?.imgMap ?? {};
  const one = orders.length === 1;
  const title = opts?.title ?? (one ? "COD Order" : "COD Orders");
  const collect = orders.reduce((s, o) => s + (o.total ?? 0), 0);

  const blocks = orders.map((o, i) => {
    const ref = o.invoice_no || String(o.id).slice(0, 8).toUpperCase();
    const items = (o.items ?? []).map((it) => {
      const sku = it.sku ?? "";
      const thumb = sku && imgMap[sku] ? `<img class="th" src="${esc(imgMap[sku])}" />` : `<span class="th ph"></span>`;
      const qty = Number(it.qty) || 1;
      const line = it.price != null ? formatPaise((it.price || 0) * qty) : "";
      return `
        <tr>
          <td class="tc">${thumb}</td>
          <td class="sku">${esc(sku)}</td>
          <td>${esc(it.name ?? "")}${it.color ? ` — ${esc(it.color)}` : ""}</td>
          <td class="r">${esc(qty)}</td>
          <td class="r">${it.price != null ? esc(formatPaise(it.price)) : ""}</td>
          <td class="r">${esc(line)}</td>
        </tr>`;
    }).join("");
    const pcs = (o.items ?? []).reduce((s, it) => s + (Number(it.qty) || 0), 0);
    return `
      <div class="cart">
        <div class="head">
          <div><span class="n">#${i + 1}</span> <b>${esc(ref)}</b>
            <span class="tag cod">COD — COLLECT ON DELIVERY</span>
            <span class="tag ${o.channel === "wholesale" ? "w" : "r2"}">${esc((o.channel || "retail").toUpperCase())}</span>
          </div>
          <div class="total">${o.total != null ? esc(formatPaise(o.total)) : ""}</div>
        </div>
        <div class="meta">
          👤 ${esc(o.customer_name || "Customer")} &nbsp;·&nbsp; 📞 ${esc(o.customer_phone || "Not captured")}
          &nbsp;·&nbsp; 🕑 ${esc(dt(o.created_at))} &nbsp;·&nbsp; ${esc(pcs)} pc${pcs === 1 ? "" : "s"}
        </div>
        <div class="meta">📦 ${esc(o.buyer_address || "No delivery address")}</div>
        <table class="items"><thead><tr><th></th><th>SKU</th><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Line</th></tr></thead>
          <tbody>${items || `<tr><td colspan="6" class="muted">No item detail</td></tr>`}</tbody></table>
      </div>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — BlytheDIVA</title><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 24px; }
    h1 { font-size: 20px; margin: 0 0 2px; }
    .sub { color: #666; font-size: 12px; margin-bottom: 16px; }
    .cart { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
    .head { display: flex; justify-content: space-between; align-items: center; break-after: avoid; page-break-after: avoid; }
    .n { color: #999; font-weight: 700; }
    .total { font-weight: 700; font-size: 15px; }
    .tag { font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 10px; margin-left: 6px; vertical-align: middle; }
    .w { background: #e7f0ff; color: #1447c9; } .r2 { background: #eee; color: #555; }
    .cod { background: #fff4e5; color: #b45309; }
    .meta { color: #555; font-size: 12px; margin: 4px 0 6px; }
    table.items { width: 100%; border-collapse: collapse; font-size: 11px; }
    table.items thead { display: table-header-group; }
    table.items tr { break-inside: avoid; page-break-inside: avoid; }
    table.items th { text-align: left; color: #888; border-bottom: 1px solid #eee; padding: 2px 4px; font-weight: 600; }
    table.items td { padding: 3px 4px; border-bottom: 1px solid #f3f3f3; vertical-align: middle; }
    .tc { width: 40px; }
    .th { width: 34px; height: 34px; object-fit: cover; border-radius: 4px; display: inline-block; background: #f3f3f3; border: 1px solid #eee; }
    .sku { font-family: 'Courier New', monospace; font-weight: 700; white-space: nowrap; }
    .r { text-align: right; } .muted { color: #999; }
    .bar { position: sticky; top: 0; background: #fff; padding: 8px 0 12px; margin-bottom: 6px; border-bottom: 1px solid #eee; }
    .bar button { font: 600 13px Arial; background: #0f766e; color: #fff; border: 0; border-radius: 999px; padding: 9px 18px; cursor: pointer; }
    @media print { body { margin: 12mm; } .bar { display: none; } }
  </style></head><body>
    <div class="bar"><button onclick="window.print()">⬇ Save as PDF</button></div>
    <h1>${esc(title)} — BlytheDIVA</h1>
    <div class="sub">${orders.length} COD order${orders.length === 1 ? "" : "s"} · ${formatPaise(collect)} to collect on delivery · generated ${esc(dt(new Date().toISOString()))}</div>
    ${blocks || `<p class="muted">No COD orders.</p>`}
    <script>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},400);});<\/script>
  </body></html>`;

  const w = window.open("", "_blank");
  if (!w) { alert("Please allow pop-ups for this site, then click Download PDF again."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}
