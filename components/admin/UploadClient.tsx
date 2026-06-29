"use client";
import { useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import {
  createProductWithImageAction, createOneRowAction, aiParseRowsAction,
  createCategoryJsonAction,
} from "@/app/actions/catalog";
import { getProductVariantsAction, addVariantImageAction } from "@/app/actions/variants";
import { generateContentAction } from "@/app/actions/aiContent";
import { compressImage } from "@/lib/image";

type Cat = { id: string; name: string };
type LogLine = { text: string; status: "run" | "ok" | "err" };
type VariantOptions = { color: string[]; size: string[]; polish: string[] };
type ColorCodeMap = Record<string, string>;

/** One row in the Variants editor (strings so inputs stay controlled even when blank). */
type VariantRow = {
  key: string;       // stable React key
  color: string;
  size: string;
  polish: string;
  sku: string;
  qty: string;
  retail: string;
  wholesale: string;
  mrp: string;
  image: File | null; // optional per-variant photo, uploaded right after create (Pillar 16)
};

const emptyVariant = (): VariantRow => ({
  key: Math.random().toString(36).slice(2),
  color: "", size: "", polish: "", sku: "", qty: "", retail: "", wholesale: "", mrp: "", image: null,
});

/** A variant row counts as "real" when at least one of colour/size/polish is filled. */
const isRealVariant = (v: VariantRow) =>
  Boolean(v.color.trim() || v.size.trim() || v.polish.trim());

export function UploadClient({
  categories,
  variantOptions = { color: [], size: [], polish: [] },
  colorCodes = {},
}: {
  categories: Cat[];
  variantOptions?: VariantOptions;
  /** Lowercased colour name → canonical barcode suffix (RED, MULTI1, SBLUE…). */
  colorCodes?: ColorCodeMap;
}) {
  const { toast } = useToast();
  const [cats, setCats] = useState<Cat[]>(categories);
  const [catId, setCatId] = useState("");
  const [newCat, setNewCat] = useState(""); const [showNewCat, setShowNewCat] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", qty: "", type: "simple" as "simple" | "configurable", colors: "", sku: "" });
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [csv, setCsv] = useState("");
  const [writeAi, setWriteAi] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald transition-colors";
  const vInput = "rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm outline-none focus:border-emerald transition-colors";
  const catName = cats.find((c) => c.id === catId)?.name;
  const push = (line: LogLine) => setLog((l) => [...l, line]);
  const patchLast = (status: "ok" | "err", text?: string) => setLog((l) => l.map((x, i) => i === l.length - 1 ? { text: text ?? x.text, status } : x));

  // Live totals so the owner can see at a glance what they're about to create.
  const realVariants = useMemo(() => variants.filter(isRealVariant), [variants]);
  const variantStockTotal = useMemo(
    () => realVariants.reduce((s, v) => s + (Number(v.qty) || 0), 0),
    [realVariants],
  );

  /** Live preview of the barcode/SKU that will be printed on the variant's label.
   *  Mirrors the server's autoSku() logic exactly so what you see here is what
   *  prints later. Falls back to a derived suffix if a colour isn't in the master. */
  const previewSku = (v: VariantRow): string => {
    const parent = (form.sku.trim() || "BD####").toUpperCase();
    if (v.sku.trim()) return v.sku.trim().toUpperCase().replace(/\s+/g, "-");
    const colorCode = v.color.trim()
      ? (colorCodes[v.color.trim().toLowerCase()] ?? v.color.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
      : null;
    const sizeCode = v.size.trim() ? v.size.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
    const polishCode = v.polish.trim() ? v.polish.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) : null;
    const suffix = [colorCode, sizeCode, polishCode].filter(Boolean).join("-") || "VAR";
    return `${parent}-${suffix}`;
  };

  async function createCat() {
    const nm = newCat.trim(); if (!nm) return;
    setBusy(true);
    const res = await createCategoryJsonAction(nm);
    setBusy(false);
    if (res) { setCats((c) => [...c, res]); setCatId(res.id); setNewCat(""); setShowNewCat(false); toast(`Category “${res.name}” created`); }
    else toast("Couldn't create category", "error");
  }

  /** Generate the AI page for a sku, with a visible log line. */
  async function writeAiPage(sku: string, name: string) {
    push({ text: `Writing AI page for ${name} (${sku})…`, status: "run" });
    const r = await generateContentAction(sku);
    patchLast(r.ok ? "ok" : "err", r.ok ? `AI page written for ${sku} ✓` : `AI page skipped for ${sku}`);
  }

  // ---- Variant row helpers ----
  const updateVariant = (idx: number, patch: Partial<VariantRow>) =>
    setVariants((vs) => vs.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const addVariantRow = () => setVariants((vs) => [...vs, emptyVariant()]);
  const removeVariantRow = (idx: number) => setVariants((vs) => vs.filter((_, i) => i !== idx));

  /** Turn the "Colours, comma separated" shortcut into editable rows so the owner can
   *  add size/polish/price per colour without retyping anything. */
  function buildRowsFromColours() {
    const colours = form.colors.split(",").map((s) => s.trim()).filter(Boolean);
    if (!colours.length) { toast("Add some colours first (comma separated)", "error"); return; }
    const totalQty = Math.max(0, Number(form.qty) || 0);
    const per = colours.length ? Math.floor(totalQty / colours.length) : 0;
    setVariants(colours.map((c) => ({ ...emptyVariant(), color: c, qty: per ? String(per) : "" })));
    toast(`Built ${colours.length} variant row${colours.length === 1 ? "" : "s"} — edit size/polish/prices as needed`);
  }

  function clearVariantRows() { setVariants([]); }

  async function addSingle() {
    if (!form.name.trim() || !(Number(form.price) > 0)) { toast("Add a name and a base price first", "error"); return; }

    // When the owner is in "configurable" mode and has spelled out variant rows, the rows ARE
    // the source of truth — the comma list and the top-level Stock qty are ignored. Validate
    // the rows up-front so we fail fast with a helpful message.
    const useVariantRows = form.type === "configurable" && realVariants.length > 0;
    if (useVariantRows) {
      const skus = realVariants.map((v) => v.sku.trim().toUpperCase()).filter(Boolean);
      const dup = skus.find((s, i) => skus.indexOf(s) !== i);
      if (dup) { toast(`Duplicate variant SKU "${dup}" — make each one unique`, "error"); return; }
      if (variantStockTotal <= 0) { toast("Add stock qty to at least one variant", "error"); return; }
    }

    setBusy(true); setLog([]); setProgress({ done: 0, total: writeAi ? 2 : 1 });
    try {
      const fd = new FormData();
      fd.set("categoryId", catId); fd.set("name", form.name.trim()); fd.set("price", form.price);
      // If variant rows are present, send the SUM as the product qty so it matches what gets
      // saved — but the server also recomputes from rows, so this is mostly informational.
      fd.set("qty", useVariantRows ? String(variantStockTotal) : form.qty);
      fd.set("type", form.type);
      // Keep sending the comma list — it's the back-compat path the server uses when no
      // structured rows are provided. Empty when rows take over.
      fd.set("colors", useVariantRows ? "" : form.colors);
      if (form.sku.trim()) fd.set("sku", form.sku.trim());

      if (useVariantRows) {
        // Compact payload the server action parses (see createProductWithImageAction).
        const payload = realVariants.map((v) => ({
          color: v.color.trim() || undefined,
          size: v.size.trim() || undefined,
          polish: v.polish.trim() || undefined,
          sku: v.sku.trim() || undefined,
          qty: Number(v.qty) || 0,
          retailRupees: v.retail ? Number(v.retail) : null,
          wholesaleRupees: v.wholesale ? Number(v.wholesale) : null,
          mrpRupees: v.mrp ? Number(v.mrp) : null,
        }));
        fd.set("variants", JSON.stringify(payload));
      }

      let file = fileRef.current?.files?.[0] ?? null;
      if (file) { push({ text: "Optimising photo…", status: "run" }); file = await compressImage(file); fd.set("image", file); patchLast("ok", "Photo optimised ✓"); }
      push({ text: `Creating ${form.name.trim()}${useVariantRows ? ` with ${realVariants.length} variant${realVariants.length === 1 ? "" : "s"}` : ""}…`, status: "run" });
      const res = await createProductWithImageAction(fd);
      if (!res.ok) { patchLast("err", `Failed: ${res.error}`); toast(res.error ?? "Could not add", "error"); return; }
      patchLast("ok", `Created ${res.sku} ✓ · saved as draft — publish it from the catalogue when ready`);

      // Pillar 16 — attach any per-variant photos picked in the editor. We resolve the
      // freshly-created variants by SKU, match each editor row by colour/size/polish, and
      // upload its photo to that variant. Best-effort: a failed match just skips that photo.
      if (useVariantRows && res.sku) {
        const withPhotos = realVariants.filter((v) => v.image);
        if (withPhotos.length) {
          push({ text: `Adding ${withPhotos.length} variant photo${withPhotos.length === 1 ? "" : "s"}…`, status: "run" });
          try {
            const created = await getProductVariantsAction(res.sku);
            const norm = (s?: string | null) => (s ?? "").trim().toLowerCase();
            let done = 0;
            for (const row of withPhotos) {
              const match = created.find((cv) =>
                norm(cv.color) === norm(row.color) && norm(cv.size) === norm(row.size) && norm(cv.polish) === norm(row.polish));
              if (!match || !row.image) continue;
              const img = await compressImage(row.image);
              const vfd = new FormData();
              vfd.set("id", match.id);
              vfd.set("product_sku", res.sku);
              vfd.append("images", img);
              const r = await addVariantImageAction(vfd);
              if (r.ok) done++;
            }
            patchLast(done > 0 ? "ok" : "err", done > 0 ? `Added ${done} variant photo${done === 1 ? "" : "s"} ✓` : "Couldn't match variant photos — add them from the product's Variants tab.");
          } catch {
            patchLast("err", "Variant photos skipped — add them from the product's Variants tab.");
          }
        }
      }

      setProgress({ done: 1, total: writeAi ? 2 : 1 });
      if (writeAi && res.sku) { await writeAiPage(res.sku, form.name.trim()); setProgress({ done: 2, total: 2 }); }
      toast(`${res.sku} added`);
      setForm({ name: "", price: "", qty: "", type: "simple", colors: "", sku: "" });
      setVariants([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      patchLast("err", e instanceof Error ? e.message : "Upload failed");
      toast("Something went wrong", "error");
    } finally { setBusy(false); }
  }

  async function buildFromList() {
    if (!csv.trim()) { toast("Paste or upload your list first", "error"); return; }
    setBusy(true); setLog([]); setProgress(null);
    try {
      push({ text: "Reading your list with AI…", status: "run" });
      const { rows, usedAi } = await aiParseRowsAction(csv);
      if (rows.length === 0) { patchLast("err", "Couldn't read any products from that list."); toast("Nothing to import", "error"); return; }
      patchLast("ok", `Found ${rows.length} product${rows.length === 1 ? "" : "s"}${usedAi ? " · AI mapped your columns" : ""}`);
      setProgress({ done: 0, total: rows.length });

      let created = 0;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        push({ text: `Creating ${i + 1} of ${rows.length}: ${r.name}…`, status: "run" });
        const res = await createOneRowAction(catId, r);
        if (res.ok) { created++; patchLast("ok", `Created ${res.sku} — ${r.name} ✓`); if (writeAi && res.sku) await writeAiPage(res.sku, r.name); }
        else patchLast("err", `Skipped ${r.name}: ${res.error}`);
        setProgress({ done: i + 1, total: rows.length });
      }
      push({ text: `Done — ${created} of ${rows.length} products saved as drafts in ${catName}. Add photos (or Show them) to publish ✓`, status: "ok" });
      toast(`${created} products added`);
      setCsv("");
    } catch (e) {
      patchLast("err", e instanceof Error ? e.message : "Import failed");
      toast("Import failed", "error");
    } finally { setBusy(false); }
  }

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const showVariantsEditor = form.type === "configurable";

  return (
    <div className="max-w-3xl">
      {/* Datalists power as-you-type suggestions for variant attributes. Typing a brand-new
          value is fine — the server upserts it into variant_options so it shows up here
          next time, matching the catalogue's Variants tab behaviour. */}
      <datalist id="upload-opt-color">{variantOptions.color.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="upload-opt-size">{variantOptions.size.map((o) => <option key={o} value={o} />)}</datalist>
      <datalist id="upload-opt-polish">{variantOptions.polish.map((o) => <option key={o} value={o} />)}</datalist>

      <div className="bg-white rounded-2xl p-6 shadow-card mb-5">
        <label className="text-sm font-medium text-ink">Step 1 · Choose a category <span className="text-rose">*</span></label>
        <p className="text-xs text-muted mb-2">Everything you upload goes under this category — no misclassification.</p>
        <div className="flex gap-2">
          <select value={catId} onChange={(e) => setCatId(e.target.value)} className={input}>
            <option value="">Select a category…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" onClick={() => setShowNewCat((v) => !v)} className="px-4 rounded-xl border border-emerald text-emerald text-sm whitespace-nowrap hover:bg-emerald-mist transition-colors">+ New</button>
        </div>
        {showNewCat && (
          <div className="flex gap-2 mt-2">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name (e.g. Maang Tikka)" className={input} />
            <button type="button" onClick={createCat} disabled={busy} className="px-4 rounded-xl bg-ink text-white text-sm whitespace-nowrap disabled:opacity-50">Create</button>
          </div>
        )}
      </div>

      <div className={`bg-white rounded-2xl p-6 shadow-card transition-opacity ${catId ? "" : "opacity-40 pointer-events-none"}`}>
        <div className="flex items-center justify-between mb-4">
          <label className="text-sm font-medium text-ink">Step 2 · Add designs</label>
          <div className="flex gap-1 bg-cream rounded-full p-1">
            {(["single", "bulk"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 rounded-full text-xs ${mode === m ? "bg-ink text-white" : "text-muted"}`}>{m === "single" ? "Single" : "List / Sheet"}</button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink mb-4 cursor-pointer">
          <input type="checkbox" checked={writeAi} onChange={(e) => setWriteAi(e.target.checked)} className="accent-emerald" />
          Let AI write each product page (description, tags, SEO) as it creates them
        </label>

        {mode === "single" ? (
          <div className="space-y-3">
            <input className={input} placeholder="Design name (e.g. Rajwadi Kundan Necklace)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <input className={input} placeholder="Base wholesale ₹" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              <input
                className={input}
                placeholder={showVariantsEditor && realVariants.length > 0 ? `Stock qty (auto: ${variantStockTotal})` : "Stock qty"}
                inputMode="numeric"
                value={showVariantsEditor && realVariants.length > 0 ? String(variantStockTotal) : form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })}
                disabled={showVariantsEditor && realVariants.length > 0}
                title={showVariantsEditor && realVariants.length > 0 ? "Stock is the sum of your variant rows" : undefined}
              />
            </div>
            <input className={`${input} font-mono`} placeholder="SKU (optional — leave blank to auto-generate BD####)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as "simple" | "configurable" })}>
                <option value="simple">Simple (one item)</option>
                <option value="configurable">Configurable (colour / size / polish)</option>
              </select>
              <input className={input} placeholder="Colours, comma separated" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} disabled={form.type !== "configurable"} />
            </div>

            {/* -------- Variants editor (only when configurable). Optional: if the owner leaves
                it empty, the comma list still works the old way. -------- */}
            {showVariantsEditor && (
              <div className="rounded-2xl border border-sand bg-cream/30 p-4">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div>
                    <p className="text-sm font-medium text-ink">Variants <span className="text-muted font-normal">— colour, size, polish, stock &amp; price</span></p>
                    <p className="text-[11px] text-muted">Each row creates one variant with its own SKU and stock. Leave a price <b>blank</b> to use the formula price.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {form.colors.trim() && (
                      <button type="button" onClick={buildRowsFromColours} className="px-3 py-1.5 rounded-full bg-emerald-mist text-emerald-dark text-xs hover:bg-emerald-mist/70">
                        Build from colours →
                      </button>
                    )}
                    <button type="button" onClick={addVariantRow} className="px-3 py-1.5 rounded-full bg-ink text-white text-xs">+ Add variant</button>
                    {variants.length > 0 && (
                      <button type="button" onClick={clearVariantRows} className="text-[11px] text-muted hover:text-rose">clear</button>
                    )}
                  </div>
                </div>

                {variants.length === 0 ? (
                  <p className="text-xs text-muted py-3">
                    No variant rows yet. {form.colors.trim() ? (
                      <>The comma list above will be used as plain colour-only variants, or click <b>Build from colours</b> to turn it into editable rows.</>
                    ) : (
                      <>Click <b>+ Add variant</b> to start. You can mix any of colour / size / polish per row.</>
                    )}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {/* Column header — hidden on narrow screens to keep things readable. */}
                    <div className="hidden md:grid grid-cols-[1fr_0.8fr_1fr_0.8fr_1.1fr_0.9fr_0.9fr_0.9fr_auto] gap-1.5 text-[10px] uppercase tracking-wide text-muted px-1">
                      <span>Colour</span><span>Size</span><span>Polish</span><span>Stock</span><span>SKU</span><span>Retail ₹</span><span>Wholesale ₹</span><span>MRP ₹</span><span aria-hidden />
                    </div>
                    {variants.map((v, idx) => (
                      <div key={v.key} className="grid grid-cols-2 md:grid-cols-[1fr_0.8fr_1fr_0.8fr_1.1fr_0.9fr_0.9fr_0.9fr_auto] gap-1.5 items-center">
                        <input
                          className={vInput} list="upload-opt-color" placeholder="Colour"
                          value={v.color} onChange={(e) => updateVariant(idx, { color: e.target.value })}
                        />
                        <input
                          className={vInput} list="upload-opt-size" placeholder="Size"
                          value={v.size} onChange={(e) => updateVariant(idx, { size: e.target.value })}
                        />
                        <input
                          className={vInput} list="upload-opt-polish" placeholder="Polish"
                          value={v.polish} onChange={(e) => updateVariant(idx, { polish: e.target.value })}
                        />
                        <input
                          className={`${vInput} text-center`} type="number" min={0} step={1} placeholder="0" inputMode="numeric"
                          value={v.qty} onChange={(e) => updateVariant(idx, { qty: e.target.value })}
                        />
                        <input
                          className={`${vInput} font-mono`} placeholder="auto"
                          value={v.sku} onChange={(e) => updateVariant(idx, { sku: e.target.value })}
                        />
                        <input
                          className={`${vInput} text-right`} type="number" min={0} step="0.01" placeholder="auto" inputMode="decimal"
                          value={v.retail} onChange={(e) => updateVariant(idx, { retail: e.target.value })}
                        />
                        <input
                          className={`${vInput} text-right`} type="number" min={0} step="0.01" placeholder="auto" inputMode="decimal"
                          value={v.wholesale} onChange={(e) => updateVariant(idx, { wholesale: e.target.value })}
                        />
                        <input
                          className={`${vInput} text-right`} type="number" min={0} step="0.01" placeholder="auto" inputMode="decimal"
                          value={v.mrp} onChange={(e) => updateVariant(idx, { mrp: e.target.value })}
                        />
                        <button
                          type="button" onClick={() => removeVariantRow(idx)}
                          className="text-muted hover:text-rose text-lg px-1 leading-none justify-self-end"
                          aria-label="Remove variant"
                          title="Remove this variant"
                        >×</button>
                        {/* Pillar 11 — live preview of the barcode/SKU that will print on
                            this variant's label. Spans both columns on narrow screens. */}
                        {isRealVariant(v) && (
                          <p className="col-span-2 md:col-span-9 text-[10px] text-muted pl-1 -mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>Barcode/SKU: <span className="font-mono text-ink/80">{previewSku(v)}</span></span>
                            {v.color.trim() && !colorCodes[v.color.trim().toLowerCase()] && (
                              <span className="text-gold-dark">· “{v.color.trim()}” isn&apos;t in the colour master — code is auto-derived</span>
                            )}
                            {/* Pillar 16 — pick a photo for this variant; uploaded right after the design is created. */}
                            <label className="inline-flex items-center gap-1 cursor-pointer text-emerald-dark hover:underline">
                              📷 {v.image ? v.image.name.slice(0, 18) : "Add photo"}
                              <input
                                type="file" accept="image/*" className="hidden"
                                onChange={(e) => updateVariant(idx, { image: e.target.files?.[0] ?? null })}
                              />
                            </label>
                            {v.image && (
                              <button type="button" onClick={() => updateVariant(idx, { image: null })} className="text-muted hover:text-rose">remove photo</button>
                            )}
                          </p>
                        )}
                      </div>
                    ))}
                    {realVariants.length > 0 && (
                      <p className="text-[11px] text-muted pt-1">
                        {realVariants.length} variant{realVariants.length === 1 ? "" : "s"} · total stock <b className="text-ink">{variantStockTotal}</b> pcs ·
                        empty rows (no colour/size/polish) are skipped.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-ink">Raw product photo <span className="text-muted font-normal">(optional — AI turns it into a model photo later)</span></label>
              <input ref={fileRef} type="file" accept="image/*" className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer" />
            </div>
            <button onClick={addSingle} disabled={busy} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Working…" : "✨ Add design"}</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">Paste any list — even messy. The AI figures out names, prices, stock, colours and SKUs. Or use a header row (any column order): <code className="bg-cream px-1 rounded">name, sku, base_price, qty, type, colours|pipe</code> — <b>sku is optional</b> (blank = auto BD####). · <a download="blythe-diva-bulk-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent("name,sku,base_price,qty,type,colours\nRajwadi Kundan Necklace,KN101,850,12,configurable,Red|Green|Blue\nPearl Studs,PS160,160,40,simple,\nMeenakari Bangles,MB540,540,25,configurable,Red|Green")}`} className="text-emerald nav-link">⤓ Download CSV template</a></p>
            <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setCsv(String(r.result || "")); r.readAsText(f); } }}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer" />
            <textarea className={`${input} font-mono text-xs`} rows={6} placeholder={"Kundan Choker, 850, 12, configurable, Red|Green|Blue\nPearl Studs 160 rs 40pcs\nMeena bangles - 540 - 25 - red,green"} value={csv} onChange={(e) => setCsv(e.target.value)} />
            <button onClick={buildFromList} disabled={busy} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Building…" : "✨ Build inventory with AI"}</button>
          </div>
        )}

        {/* Live progress */}
        {(progress || log.length > 0) && (
          <div className="mt-5 rounded-2xl border border-sand bg-cream/40 p-4">
            {progress && (
              <div className="mb-3">
                <div className="flex justify-between text-xs text-muted mb-1"><span>Progress</span><span>{progress.done}/{progress.total} · {pct}%</span></div>
                <div className="h-2 rounded-full bg-sand overflow-hidden"><div className="h-full bg-gradient-to-r from-emerald to-gold transition-all duration-300" style={{ width: `${pct}%` }} /></div>
              </div>
            )}
            <div className="max-h-56 overflow-y-auto space-y-1 text-sm">
              {log.map((l, i) => (
                <div key={i} className={`flex items-start gap-2 ${l.status === "err" ? "text-rose" : l.status === "ok" ? "text-emerald-dark" : "text-muted"}`}>
                  <span className="w-4 text-center shrink-0">{l.status === "ok" ? "✓" : l.status === "err" ? "✕" : "◔"}</span>
                  <span>{l.text}</span>
                </div>
              ))}
            </div>
            {!busy && progress && progress.done === progress.total && (
              <Link href="/admin/catalogue" className="inline-block mt-3 text-sm text-emerald nav-link">View in catalogue →</Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
