"use client";
import { useState, useMemo } from "react";
import { formatPaise } from "@/lib/pricing";
import { recordPurchaseAction } from "@/app/actions/purchases";
import { fileToCsv } from "@/lib/sheetImport";

/** Pull the first number out of a cell like "INR 14.5", "₹ 50", "6 pcs" → 14.5 / 50 / 6. */
const num = (s: string) => {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};

type Sup = { id: string; name: string; city: string | null };
type Variant = { id: string; sku: string; label: string };
type Prod = { id: string; name: string; sku: string; variants?: Variant[] };
type Line = { supplierSku: string; mappedProductId: string; mappedName: string; variantId: string; qty: string; cost: string };
type PayMethod = { id: string; name: string; kind: string };

type LastCosts = { byProduct: Record<string, number>; byVariant: Record<string, number> };

/** Map a payment method to the coarse mode the supplier ledger stores. */
const modeOf = (m: PayMethod): "cash" | "upi" | "bank" =>
  String(m.kind).toLowerCase() === "cash" ? "cash" : /upi/i.test(m.name) ? "upi" : "bank";

export function PurchaseClient({ suppliers, products, lastCosts, methods = [] }: { suppliers: Sup[]; products: Prod[]; lastCosts?: LastCosts; methods?: PayMethod[] }) {
  const [supplierId, setSupplierId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [lines, setLines] = useState<Line[]>([{ supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDup, setConfirmDup] = useState(false);
  // How this purchase was paid — a SPLIT across the SPECIFIC accounts (Cash / HDFC / Kotak / SBI /
  // UPI), keyed by payment_method id, so the same account's balance drops (just like POS records
  // which account received a sale). Whatever is left unpaid stays owed to the supplier (credit).
  const [payById, setPayById] = useState<Record<string, string>>({});
  // Bulk paste / upload — fill dozens of purchase lines at once (like the product bulk upload).
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");

  const input = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";
  const set = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  // Expand one mapped parent into one line per colour (same supplier code & cost) so a 15-colour
  // design can be entered in seconds — just fill the qty for each colour.
  const expandColours = (i: number) => setLines((prev) => {
    const line = prev[i];
    const vs = products.find((p) => p.id === line.mappedProductId)?.variants ?? [];
    if (!vs.length) return prev;
    const rows = vs.map((v) => ({ ...line, variantId: v.id, qty: "" }));
    return [...prev.slice(0, i), ...rows, ...prev.slice(i + 1)];
  });
  const suggest = (q: string) => q.trim() ? products.filter((p) => (p.name + p.sku).toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [];
  const itemsTotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0);

  // Extra charges + OPTIONAL GST on the supplier bill (all in rupees). GST is 3% input tax, only when ticked.
  const [charges, setCharges] = useState({ packing: "", shipping: "", adjustment: "" });
  const [gst, setGst] = useState(false);
  const chargesTotal = (Number(charges.packing) || 0) + (Number(charges.shipping) || 0) + (Number(charges.adjustment) || 0);
  const beforeGst = itemsTotal + chargesTotal;
  const gstAmt = gst ? Math.round(beforeGst * 3) / 100 : 0;
  const total = beforeGst + gstAmt; // grand total the supplier is paid

  // If the owner hasn't set up named accounts, fall back to three generic ones so payment still works.
  const payMethods: PayMethod[] = methods.length ? methods : [
    { id: "cash", name: "Cash", kind: "cash" }, { id: "upi", name: "UPI", kind: "bank" }, { id: "bank", name: "Bank", kind: "bank" },
  ];
  // Split-payment maths (rupees). paidNow = sum across every account; the rest stays on credit.
  const paidNow = payMethods.reduce((n, m) => n + (Number(payById[m.id]) || 0), 0);
  const credit = Math.max(0, total - paidNow);
  const over = paidNow > total && total > 0;
  /** Fill one account with whatever is still unpaid (so "HDFC: fill remaining" pays the balance). */
  const fillRemaining = (id: string) => setPayById((s) => {
    const others = payMethods.filter((m) => m.id !== id).reduce((n, m) => n + (Number(s[m.id]) || 0), 0);
    const rem = Math.max(0, total - others);
    return { ...s, [id]: rem ? String(rem) : "" };
  });

  // ---- Bulk paste / upload: match each row's SKU to a product/variant, then fill the lines ----
  // A row's SKU is looked up against every VARIANT sku first (e.g. "NKE1001-Silver"), then the
  // plain PRODUCT sku. Unmatched SKUs are still added (unmapped) so the bill is complete and the
  // owner can map them later — exactly like a manually-typed unmapped line.
  const skuIndex = useMemo(() => {
    const byVariant = new Map<string, { productId: string; variantId: string; name: string }>();
    const byProduct = new Map<string, { productId: string; name: string }>();
    for (const p of products) {
      if (p.sku) byProduct.set(p.sku.trim().toUpperCase(), { productId: p.id, name: `${p.name} (${p.sku})` });
      for (const v of p.variants ?? []) {
        if (v.sku) byVariant.set(v.sku.trim().toUpperCase(), { productId: p.id, variantId: v.id, name: `${p.name} · ${v.label}` });
      }
    }
    return { byVariant, byProduct };
  }, [products]);

  function parseBulkText(text: string): { sku: string; qty: number; cost: number }[] {
    const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!rows.length) return [];
    const split = (l: string) => l.split(/[\t,]/).map((s) => s.trim());
    const head = split(rows[0]).map((h) => h.toLowerCase());
    const joined = head.join(" ");
    const hasHeader = /sku|item|code/.test(joined) && /(qty|quantity|price|cost|amount|rate)/.test(joined);
    // SKU column: prefer an exact "sku"; else code/item.
    const findCol = (prefer: string[], fallback: string[]) => {
      let i = head.findIndex((h) => prefer.some((n) => h === n || h.includes(n)));
      if (i < 0) i = head.findIndex((h) => fallback.some((n) => h.includes(n)));
      return i;
    };
    let iSku = 0, iQty = 1, iPrice = 2, iDisc = -1;
    let body = rows;
    if (hasHeader) {
      iSku = findCol(["sku"], ["item code", "code", "item"]);
      iQty = findCol(["quantity", "qty"], ["pcs", "pieces"]);
      iPrice = findCol(["price", "cost", "rate", "unit"], ["amount"]);
      iDisc = head.findIndex((h) => h.includes("discount") || h === "disc");
      body = rows.slice(1);
    }
    return body.map((l) => {
      const c = split(l);
      const sku = (iSku >= 0 ? c[iSku] : "")?.trim() ?? "";
      const qty = Math.max(0, Math.round(num(iQty >= 0 ? c[iQty] : "")));
      const price = Math.max(0, num(iPrice >= 0 ? c[iPrice] : ""));
      // Discount (optional): a plain number = ₹ off per unit; "10%" = percent off the unit price.
      let cost = price;
      if (iDisc >= 0 && c[iDisc]) {
        const d = num(c[iDisc]);
        cost = /%/.test(c[iDisc]) ? price * (1 - d / 100) : price - d;
      }
      return { sku, qty, cost: Math.max(0, Math.round(cost * 100) / 100) };
    }).filter((r) => r.sku);
  }

  function applyBulk() {
    const parsed = parseBulkText(bulkText);
    if (!parsed.length) { setBulkMsg("✕ Couldn't read any rows. Use columns: sku, quantity, price (discount optional)."); return; }
    let matched = 0, unmapped = 0;
    const newLines: Line[] = parsed.map((r) => {
      const key = r.sku.toUpperCase();
      const v = skuIndex.byVariant.get(key);
      const p = !v ? skuIndex.byProduct.get(key) : undefined;
      if (v) { matched++; return { supplierSku: r.sku, mappedProductId: v.productId, mappedName: v.name, variantId: v.variantId, qty: r.qty ? String(r.qty) : "", cost: r.cost ? String(r.cost) : "" }; }
      if (p) { matched++; return { supplierSku: r.sku, mappedProductId: p.productId, mappedName: p.name, variantId: "", qty: r.qty ? String(r.qty) : "", cost: r.cost ? String(r.cost) : "" }; }
      unmapped++;
      return { supplierSku: r.sku, mappedProductId: "", mappedName: "", variantId: "", qty: r.qty ? String(r.qty) : "", cost: r.cost ? String(r.cost) : "" };
    });
    // Replace the blank starter line; otherwise append to whatever's already there.
    setLines((prev) => {
      const keep = prev.filter((l) => l.supplierSku.trim() || l.mappedProductId || l.qty.trim() || l.cost.trim());
      return [...keep, ...newLines];
    });
    setBulkText(""); setShowBulk(false);
    setBulkMsg(`✓ Added ${newLines.length} line${newLines.length === 1 ? "" : "s"} · ${matched} matched to products${unmapped ? ` · ${unmapped} unmapped (map them below or leave to skip stock)` : ""}.`);
  }

  async function submit(force = false) {
    // A mapped product that HAS colours must be bought as a specific colour — never the parent.
    const missing = lines.find((l) => {
      if (!l.mappedProductId || !(Number(l.qty) > 0)) return false;
      const hasVariants = (products.find((p) => p.id === l.mappedProductId)?.variants ?? []).length > 0;
      return hasVariants && !l.variantId;
    });
    if (missing) { setMsg(`✕ Pick a colour for "${missing.mappedName}" — products with colours are bought per colour, not as the whole product.`); return; }
    if (over) { setMsg(`✕ Paid ${formatPaise(paidNow * 100)} is more than the bill total ${formatPaise(total * 100)} — reduce a method.`); return; }
    setBusy(true); setMsg(""); if (!force) setConfirmDup(false);
    // Split payment: one leg per ACCOUNT that has an amount (with its methodId so the exact account's
    // balance drops). Named accounts pass a real methodId; the generic fallback passes none.
    const payments = payMethods
      .map((m) => ({ methodId: methods.length ? m.id : undefined, mode: modeOf(m), amountRupees: Number(payById[m.id]) || 0 }))
      .filter((p) => p.amountRupees > 0);
    const res = await recordPurchaseAction({
      supplierId, billNo, force,
      items: lines.map((l) => ({ supplierSku: l.supplierSku, mappedProductId: l.mappedProductId, variantId: l.variantId, qty: Number(l.qty) || 0, unitCostRupees: Number(l.cost) || 0 })),
      payments,
      packingRupees: Number(charges.packing) || 0, shippingRupees: Number(charges.shipping) || 0,
      adjustmentRupees: Number(charges.adjustment) || 0, gst,
    });
    setBusy(false);
    if (res.ok) {
      const owed = Math.max(0, total - paidNow);
      setMsg(`✓ Purchase recorded (${formatPaise(res.total ?? 0)})${owed > 0 ? ` — ${formatPaise(owed * 100)} on credit to supplier` : " — paid in full"}. Stock updated.`);
      setLines([{ supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }]); setBillNo(""); setPayById({}); setCharges({ packing: "", shipping: "", adjustment: "" }); setGst(false); setConfirmDup(false);
    }
    else { setMsg(`✕ ${res.error}`); setConfirmDup(!!res.duplicateBillNo); }
  }

  return (
    <div className="bg-white rounded-2xl p-6 shadow-card mb-6">
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <select className={input} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Select supplier…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` · ${s.city}` : ""}</option>)}
        </select>
        <input className={input} placeholder="Supplier bill no." value={billNo} onChange={(e) => setBillNo(e.target.value)} />
      </div>

      {/* Bulk paste / upload — fill the whole purchase from a list instead of one line at a time. */}
      <div className="mb-3">
        <button type="button" onClick={() => { setShowBulk((v) => !v); setBulkMsg(""); }}
          className="text-sm px-3 py-1.5 rounded-full border border-emerald text-emerald-dark hover:bg-emerald-mist">
          {showBulk ? "✕ Close bulk entry" : "⇪ Bulk paste / upload a list"}
        </button>
        {showBulk && (
          <div className="mt-2 rounded-2xl border border-sand bg-cream/40 p-4">
            <p className="text-xs text-muted mb-2">
              Paste your purchase list, or upload an <b>Excel (.xlsx)</b> / CSV. Columns (any order):
              <code className="bg-cream px-1 rounded ml-1">sku, quantity, price, discount</code> — discount is optional
              (a number = ₹ off per piece, or <code className="bg-cream px-1 rounded">10%</code>). Each SKU maps to the product/variant automatically.
              <a download="blythe-diva-purchase-template.csv"
                href={`data:text/csv;charset=utf-8,${encodeURIComponent("sku,quantity,price,discount\nNKE1001-Silver,6,50,\nNKE1022-Black,6,45,\nNKE1038-Silver,6,14.5,")}`}
                className="text-emerald nav-link ml-1">⤓ template</a>
            </p>
            <input type="file" accept=".csv,text/csv,.txt,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { setBulkText(await fileToCsv(f)); setBulkMsg("File loaded — review below, then Add to purchase."); } catch { setBulkMsg("✕ Couldn't read that file. Save it as .xlsx or .csv and try again."); } }}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer mb-2" />
            <textarea className={`${input} w-full font-mono text-xs`} rows={6} placeholder={"NKE1001-Silver, 6, 50\nNKE1022-Black, 6, 45\nNKE1038-Silver, 6, 14.5"} value={bulkText} onChange={(e) => setBulkText(e.target.value)} />
            <button type="button" onClick={applyBulk} className="btn-primary px-5 py-2 text-sm font-medium mt-2">Add to purchase →</button>
          </div>
        )}
        {bulkMsg && <p className={`text-xs mt-2 ${bulkMsg.startsWith("✕") ? "text-rose" : "text-emerald-dark"}`}>{bulkMsg}</p>}
      </div>

      <p className="text-xs text-muted mb-2">Type the supplier&apos;s item name/code — we suggest your internal SKU. Map it, or leave unmapped to skip the stock update.</p>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-start">
            <div className="col-span-5 relative">
              <input className={input + " w-full"} placeholder="Supplier item / code" value={l.supplierSku}
                onChange={(e) => { set(i, { supplierSku: e.target.value }); setOpenIdx(i); }} onFocus={() => setOpenIdx(i)} />
              {l.mappedName ? (
                <>
                  <p className="text-[11px] text-emerald-dark mt-0.5">→ {l.mappedName} <button onClick={() => set(i, { mappedProductId: "", mappedName: "", variantId: "" })} className="text-muted underline ml-1">change</button></p>
                  {(() => {
                    const vs = products.find((p) => p.id === l.mappedProductId)?.variants ?? [];
                    if (!vs.length) return null;
                    // Products with colours are only ever bought as a specific colour — the parent
                    // SKU isn't a real stockable item. So force a colour choice (no "whole product").
                    return (
                      <div className="mt-1 flex items-center gap-1.5">
                        <select className={`${input} flex-1 text-xs ${l.variantId ? "" : "border-rose text-rose"}`} value={l.variantId} onChange={(e) => set(i, { variantId: e.target.value })}>
                          <option value="" disabled>Choose colour / variant…</option>
                          {vs.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.sku}</option>)}
                        </select>
                        {vs.length > 1 && (
                          <button type="button" onClick={() => expandColours(i)}
                            className="shrink-0 text-[11px] px-2 py-1.5 rounded-lg bg-emerald-mist text-emerald-dark hover:bg-emerald/15"
                            title="Add a line for every colour of this design">+ all {vs.length} colours</button>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : openIdx === i && suggest(l.supplierSku).length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-xl shadow-luxe border border-sand overflow-hidden">
                  {suggest(l.supplierSku).map((p) => (
                    <button key={p.id} onClick={() => { set(i, { mappedProductId: p.id, mappedName: `${p.name} (${p.sku})`, variantId: "" }); setOpenIdx(null); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-emerald-mist">{p.name} <span className="text-muted">· {p.sku}</span></button>
                  ))}
                </div>
              )}
            </div>
            <input className={input + " col-span-2"} placeholder="Qty" inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
            <div className="col-span-3">
              <input className={input + " w-full"} placeholder="Unit cost ₹" inputMode="numeric" value={l.cost} onChange={(e) => set(i, { cost: e.target.value })} />
              {(() => {
                const last = l.variantId ? lastCosts?.byVariant?.[l.variantId] : (l.mappedProductId ? lastCosts?.byProduct?.[l.mappedProductId] : undefined);
                if (!last) return null;
                const r = Math.round(last / 100);
                return <button type="button" onClick={() => set(i, { cost: String(r) })} className="block text-[10px] text-emerald-dark mt-0.5 hover:underline" title="Use last purchase price">last ₹{r} · use</button>;
              })()}
            </div>
            <div className="col-span-2 flex items-center justify-end gap-2 pt-2 text-sm">
              <span className="sensitive">{formatPaise((Number(l.qty) || 0) * (Number(l.cost) || 0) * 100)}</span>
              <button type="button" onClick={() => setLines((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p))}
                title="Remove this line" className="text-muted hover:text-rose leading-none shrink-0">✕</button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setLines((p) => [...p, { supplierSku: "", mappedProductId: "", mappedName: "", variantId: "", qty: "", cost: "" }])} className="text-sm text-emerald nav-link mt-3">+ Add line</button>

      {/* Extra charges + optional GST on the supplier bill. */}
      <div className="mt-5 border-t border-sand pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[11px] text-muted">Packing ₹<input value={charges.packing} onChange={(e) => setCharges((c) => ({ ...c, packing: e.target.value }))} inputMode="decimal" placeholder="0" className={`${input} w-24 mt-0.5`} /></label>
          <label className="text-[11px] text-muted">Shipping ₹<input value={charges.shipping} onChange={(e) => setCharges((c) => ({ ...c, shipping: e.target.value }))} inputMode="decimal" placeholder="0" className={`${input} w-24 mt-0.5`} /></label>
          <label className="text-[11px] text-muted">Adjustment ₹ <span className="text-muted/60">(±)</span><input value={charges.adjustment} onChange={(e) => setCharges((c) => ({ ...c, adjustment: e.target.value }))} inputMode="decimal" placeholder="0" className={`${input} w-24 mt-0.5`} /></label>
          <label className="inline-flex items-center gap-1.5 text-sm text-ink cursor-pointer rounded-xl border border-sand px-3 py-2 mt-4">
            <input type="checkbox" checked={gst} onChange={(e) => setGst(e.target.checked)} className="accent-emerald" /> Add GST (3%)
          </label>
        </div>
        {/* Bill breakdown */}
        <div className="mt-3 text-sm text-ink space-y-0.5 max-w-xs">
          <div className="flex justify-between text-muted"><span>Items</span><span>{formatPaise(itemsTotal * 100)}</span></div>
          {chargesTotal !== 0 && <div className="flex justify-between text-muted"><span>Packing + Shipping + Adj.</span><span>{formatPaise(Math.round(chargesTotal * 100))}</span></div>}
          {gst && <div className="flex justify-between text-muted"><span>GST (3%)</span><span>{formatPaise(Math.round(gstAmt * 100))}</span></div>}
        </div>
      </div>

      {/* Payment — SPLIT across methods. Enter any amount against cash / upi / bank (one, several,
          or none). Whatever is left unpaid is registered as credit owed to the supplier. */}
      <div className="mt-4 border-t border-sand pt-4">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="text-lg font-semibold text-ink">Total: <span className="sensitive">{formatPaise(total * 100)}</span></span>
          <span className="text-[11px] text-muted ml-auto">Split the payment across methods — anything left over stays on credit.</span>
        </div>
        <div className="grid sm:grid-cols-3 gap-3">
          {payMethods.map((m) => (
            <div key={m.id} className="rounded-xl border border-sand p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink">{m.name}{String(m.kind).toLowerCase() === "cash" ? "" : ""}</span>
                <button type="button" onClick={() => fillRemaining(m.id)} className="text-[10px] text-emerald-dark hover:underline" title="Pay the remaining balance from this account">fill remaining</button>
              </div>
              <div className="mt-1 flex items-center gap-1">
                <span className="text-sm text-muted">₹</span>
                <input value={payById[m.id] ?? ""} onChange={(e) => setPayById((s) => ({ ...s, [m.id]: e.target.value }))} inputMode="decimal" placeholder="0" className={`${input} w-full`} />
              </div>
            </div>
          ))}
        </div>
        {methods.length > 0 && <p className="text-[11px] text-muted mt-1.5">Enter the amount against the account it was actually paid from — that account&apos;s balance drops accordingly (same as POS).</p>}
        <div className="flex flex-wrap items-center gap-3 mt-3">
          <p className="text-[11px]">
            {over ? (
              <span className="text-rose">Paid {formatPaise(paidNow * 100)} exceeds the total — reduce a method.</span>
            ) : paidNow === 0 ? (
              <span className="text-gold-dark">Nothing paid now — the full {formatPaise(total * 100)} will be owed to this supplier (credit). Record payments later from the supplier page.</span>
            ) : credit > 0 ? (
              <span className="text-muted">Paid {formatPaise(paidNow * 100)} now · <b className="text-gold-dark">{formatPaise(credit * 100)} on credit</b></span>
            ) : (
              <span className="text-emerald-dark">Paid in full ✓</span>
            )}
          </p>
          <div className="flex items-center gap-2 ml-auto">
            {confirmDup && (
              <button onClick={() => submit(true)} disabled={busy || over} className="px-4 py-2.5 rounded-xl border border-rose text-rose text-sm font-medium hover:bg-rose/10 disabled:opacity-50">Record anyway</button>
            )}
            <button onClick={() => submit(false)} disabled={busy || over} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-50">{busy ? "Recording…" : "Record purchase"}</button>
          </div>
        </div>
      </div>
      {msg && <p className={`text-sm mt-2 ${confirmDup ? "text-rose" : "text-ink"}`}>{msg}</p>}
    </div>
  );
}
