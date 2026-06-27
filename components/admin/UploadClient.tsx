"use client";
import { useState, useRef } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import {
  createProductWithImageAction, createOneRowAction, aiParseRowsAction,
  createCategoryJsonAction,
} from "@/app/actions/catalog";
import { generateContentAction } from "@/app/actions/aiContent";
import { compressImage } from "@/lib/image";

type Cat = { id: string; name: string };
type LogLine = { text: string; status: "run" | "ok" | "err" };

export function UploadClient({ categories }: { categories: Cat[] }) {
  const { toast } = useToast();
  const [cats, setCats] = useState<Cat[]>(categories);
  const [catId, setCatId] = useState("");
  const [newCat, setNewCat] = useState(""); const [showNewCat, setShowNewCat] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", price: "", qty: "", type: "simple" as "simple" | "configurable", colors: "", sku: "" });
  const [csv, setCsv] = useState("");
  const [writeAi, setWriteAi] = useState(true);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald transition-colors";
  const catName = cats.find((c) => c.id === catId)?.name;
  const push = (line: LogLine) => setLog((l) => [...l, line]);
  const patchLast = (status: "ok" | "err", text?: string) => setLog((l) => l.map((x, i) => i === l.length - 1 ? { text: text ?? x.text, status } : x));

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

  async function addSingle() {
    if (!form.name.trim() || !(Number(form.price) > 0)) { toast("Add a name and a base price first", "error"); return; }
    setBusy(true); setLog([]); setProgress({ done: 0, total: writeAi ? 2 : 1 });
    try {
      const fd = new FormData();
      fd.set("categoryId", catId); fd.set("name", form.name.trim()); fd.set("price", form.price);
      fd.set("qty", form.qty); fd.set("type", form.type); fd.set("colors", form.colors);
      if (form.sku.trim()) fd.set("sku", form.sku.trim());
      let file = fileRef.current?.files?.[0] ?? null;
      if (file) { push({ text: "Optimising photo…", status: "run" }); file = await compressImage(file); fd.set("image", file); patchLast("ok", "Photo optimised ✓"); }
      push({ text: `Creating ${form.name.trim()}…`, status: "run" });
      const res = await createProductWithImageAction(fd);
      if (!res.ok) { patchLast("err", `Failed: ${res.error}`); toast(res.error ?? "Could not add", "error"); return; }
      patchLast("ok", `Created ${res.sku} ✓${file ? " · published" : " · saved as draft (add a photo or Show it to publish)"}`);
      setProgress({ done: 1, total: writeAi ? 2 : 1 });
      if (writeAi && res.sku) { await writeAiPage(res.sku, form.name.trim()); setProgress({ done: 2, total: 2 }); }
      toast(`${res.sku} added`);
      setForm({ name: "", price: "", qty: "", type: "simple", colors: "", sku: "" });
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

  return (
    <div className="max-w-3xl">
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
              <input className={input} placeholder="Stock qty" inputMode="numeric" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </div>
            <input className={`${input} font-mono`} placeholder="SKU (optional — leave blank to auto-generate BD####)" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
                <option value="simple">Simple (one item)</option>
                <option value="configurable">Configurable (colours)</option>
              </select>
              <input className={input} placeholder="Colours, comma separated" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} disabled={form.type !== "configurable"} />
            </div>
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
