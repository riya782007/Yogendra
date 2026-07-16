"use client";
/**
 * BulkStockImport — bring the owner's OLD-software stock into this system in one upload. He exports
 * SKU + quantity from the old app (or types/pastes it), uploads here, and every item's stock is SET to
 * that number so he can start billing immediately. Reads .xlsx / .csv or pasted text.
 */
import { useState } from "react";
import { fileToCsv } from "@/lib/sheetImport";
import { bulkSetStockAction } from "@/app/actions/stock";

const num = (s: string) => {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : NaN;
};

/** Parse pasted/CSV text into { sku, qty } rows. Header-aware (sku|code + qty|quantity|stock), with a
 *  positional fallback (first col = sku, second = qty). Ignores blank lines and currency noise. */
function parseRows(text: string): { sku: string; qty: number }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const split = (l: string) => l.split(/[\t,]/).map((s) => s.trim());
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const hasHeader = /sku|code|item/.test(head.join(" ")) && /(qty|quantity|stock|pcs|count)/.test(head.join(" "));
  let iSku = 0, iQty = 1, body = lines;
  if (hasHeader) {
    iSku = head.findIndex((h) => h === "sku" || h.includes("sku") || h.includes("code") || h.includes("item"));
    iQty = head.findIndex((h) => h.includes("qty") || h.includes("quantity") || h.includes("stock") || h.includes("pcs") || h.includes("count"));
    body = lines.slice(1);
  }
  return body
    .map((l) => { const c = split(l); return { sku: (iSku >= 0 ? c[iSku] : "")?.trim() ?? "", qty: num(iQty >= 0 ? c[iQty] : "") }; })
    .filter((r) => r.sku && Number.isFinite(r.qty));
}

export function BulkStockImport() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function apply() {
    const rows = parseRows(text);
    if (!rows.length) { setMsg({ ok: false, text: "Couldn't read any rows. Use two columns: sku, qty." }); return; }
    setBusy(true); setMsg(null);
    const res = await bulkSetStockAction(rows);
    setBusy(false);
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? "Import failed." }); return; }
    const bits = [`✓ ${res.updated} item${res.updated === 1 ? "" : "s"} stock updated`];
    if (res.unchanged) bits.push(`${res.unchanged} already correct`);
    if (res.notFound) bits.push(`${res.notFound} SKU${res.notFound === 1 ? "" : "s"} not found${res.notFoundSkus?.length ? `: ${res.notFoundSkus.slice(0, 15).join(", ")}${res.notFound > 15 ? "…" : ""}` : ""}`);
    setMsg({ ok: true, text: bits.join(" · ") });
    setText("");
  }

  const tmpl = `data:text/csv;charset=utf-8,${encodeURIComponent("sku,qty\nME17,24\nNKE1001-Silver,60\nNKE1022-Black,12")}`;

  return (
    <div className="bg-white rounded-2xl p-4 shadow-card border border-sand mb-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium text-ink">Import opening stock <span className="text-xs text-muted font-normal">— bring your old software&apos;s stock in</span></p>
          <p className="text-xs text-muted">Upload SKU + quantity and every item&apos;s stock is set to that number, so you can bill right away.</p>
        </div>
        <button type="button" onClick={() => { setOpen((v) => !v); setMsg(null); }}
          className="text-sm px-3 py-1.5 rounded-full border border-emerald text-emerald-dark hover:bg-emerald-mist whitespace-nowrap">
          {open ? "✕ Close" : "⇪ Import stock"}
        </button>
      </div>
      {open && (
        <div className="mt-3 border-t border-sand pt-3">
          <p className="text-xs text-muted mb-2">
            Columns: <code className="bg-cream px-1 rounded">sku, qty</code>. Use the item&apos;s SKU or its colour SKU (e.g. <code className="bg-cream px-1 rounded">NKE1001-Silver</code>).
            <a download="blythe-diva-stock-template.csv" href={tmpl} className="text-emerald nav-link ml-1">⤓ template</a>
          </p>
          <input type="file" accept=".csv,text/csv,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setText(await fileToCsv(f)); setMsg({ ok: true, text: "File loaded — review below, then Apply." }); } catch { setMsg({ ok: false, text: "Couldn't read that file. Save as .xlsx or .csv." }); } }}
            className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer mb-2" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6}
            placeholder={"ME17, 24\nNKE1001-Silver, 60\nNKE1022-Black, 12"}
            className="w-full rounded-xl border border-sand px-3 py-2 text-sm font-mono outline-none focus:border-emerald" />
          <button type="button" onClick={apply} disabled={busy} className="btn-primary px-5 py-2 text-sm font-medium mt-2 disabled:opacity-60">{busy ? "Updating stock…" : "Apply stock →"}</button>
        </div>
      )}
      {msg && <p className={`text-xs mt-2 ${msg.ok ? "text-emerald-dark" : "text-rose"}`}>{msg.text}</p>}
    </div>
  );
}
