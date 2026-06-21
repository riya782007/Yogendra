"use client";
import { useState, useRef } from "react";
import { useToast } from "@/components/ui/Toast";
import { createProductWithImageAction, bulkUploadAction, aiBulkUploadAction, createCategoryJsonAction, type RowResult } from "@/app/actions/catalog";

type Cat = { id: string; name: string };

export function UploadClient({ categories }: { categories: Cat[] }) {
  const { toast } = useToast();
  const [cats, setCats] = useState<Cat[]>(categories);
  const [catId, setCatId] = useState("");
  const [newCat, setNewCat] = useState(""); const [showNewCat, setShowNewCat] = useState(false);
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [results, setResults] = useState<RowResult[]>([]);
  const [form, setForm] = useState({ name: "", price: "", qty: "", type: "simple" as "simple" | "configurable", colors: "" });
  const [csv, setCsv] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const input = "w-full rounded-xl border border-sand px-4 py-2.5 text-sm bg-white outline-none focus:border-emerald transition-colors";
  const catName = cats.find((c) => c.id === catId)?.name;

  async function createCat() {
    const nm = newCat.trim(); if (!nm) return;
    setBusy(true);
    const res = await createCategoryJsonAction(nm);
    setBusy(false);
    if (res) { setCats((c) => [...c, res]); setCatId(res.id); setNewCat(""); setShowNewCat(false); toast(`Category “${res.name}” created`); }
    else toast("Couldn't create category", "error");
  }

  async function addSingle() {
    setBusy(true); setMsg(""); setResults([]);
    const fd = new FormData();
    fd.set("categoryId", catId); fd.set("name", form.name.trim()); fd.set("price", form.price);
    fd.set("qty", form.qty); fd.set("type", form.type); fd.set("colors", form.colors);
    const file = fileRef.current?.files?.[0]; if (file) fd.set("image", file);
    const res = await createProductWithImageAction(fd);
    setBusy(false);
    if (res.ok) { setMsg(`✓ Added ${res.sku} to ${catName}${file ? " · photo uploaded — generate the model shot in Catalogue" : ""}`); setForm({ name: "", price: "", qty: "", type: "simple", colors: "" }); if (fileRef.current) fileRef.current.value = ""; toast(`${res.sku} added`); }
    else setMsg(`✕ ${res.error}`);
  }

  async function addBulkAi() {
    setBusy(true); setMsg(""); setResults([]);
    const res = await aiBulkUploadAction(catId, csv);
    setBusy(false); setResults(res.results);
    setMsg(`${res.created} of ${res.results.length} imported into ${catName}${res.usedAi ? " · AI mapped your columns" : ""}`);
    toast(res.usedAi ? "AI processed your spreadsheet" : `${res.created} rows imported`);
  }
  async function addBulk() {
    setBusy(true); setMsg(""); setResults([]);
    const rows = csv.split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !/^name\s*,/i.test(l)).map((l) => {
      const [name, price, qty, type, colors] = l.split(",").map((s) => s?.trim() ?? "");
      return { name, basePriceRupees: Number(price), qty: Number(qty) || 0, type: (type === "configurable" ? "configurable" : "simple") as "simple" | "configurable", colors: (colors ?? "").split("|").map((s) => s.trim()).filter(Boolean) };
    });
    const res = await bulkUploadAction(catId, rows);
    setBusy(false); setResults(res.results); setMsg(`${res.created} of ${rows.length} rows imported into ${catName}`);
  }

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
              <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 rounded-full text-xs ${mode === m ? "bg-ink text-white" : "text-muted"}`}>{m === "single" ? "Single" : "Bulk CSV"}</button>
            ))}
          </div>
        </div>

        {mode === "single" ? (
          <div className="space-y-3">
            <input className={input} placeholder="Design name (e.g. Rajwadi Kundan Necklace)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <input className={input} placeholder="Base wholesale ₹" inputMode="numeric" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              <input className={input} placeholder="Stock qty" inputMode="numeric" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
                <option value="simple">Simple (one item)</option>
                <option value="configurable">Configurable (colours)</option>
              </select>
              <input className={input} placeholder="Colours, comma separated" value={form.colors} onChange={(e) => setForm({ ...form, colors: e.target.value })} disabled={form.type !== "configurable"} />
            </div>
            <div>
              <label className="text-sm font-medium text-ink">Raw product photo <span className="text-muted font-normal">(the design as shot — AI turns it into a model photo)</span></label>
              <input ref={fileRef} type="file" accept="image/*" className="mt-1 block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer" />
            </div>
            <button onClick={addSingle} disabled={busy} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Adding…" : "Add design"}</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted">Format per line: <code className="bg-cream px-1 rounded">name, base_price, qty, type, colours|pipe|separated</code></p>
            <label className="text-sm font-medium text-ink">Upload a .csv file <span className="text-muted font-normal">or paste below</span></label>
            <input type="file" accept=".csv,text/csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) { const r = new FileReader(); r.onload = () => setCsv(String(r.result || "")); r.readAsText(f); } }}
              className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer" />
            <textarea className={`${input} font-mono text-xs`} rows={6} placeholder={"Kundan Choker, 850, 12, configurable, Red|Green|Blue\nPearl Studs, 160, 40, simple,"} value={csv} onChange={(e) => setCsv(e.target.value)} />
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={addBulkAi} disabled={busy} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">{busy ? "Processing…" : "✨ Import with AI"}</button>
              <button onClick={addBulk} disabled={busy} className="px-6 py-2.5 text-sm font-medium rounded-full border border-sand text-ink hover:border-emerald transition-colors disabled:opacity-60">Import (strict format)</button>
            </div>
            <p className="text-xs text-muted">Messy spreadsheet, different column order or headers? Use <b>Import with AI</b> — it figures out which value goes where.</p>
          </div>
        )}

        {msg && <p className="text-sm mt-3 text-ink">{msg}</p>}
        {results.length > 0 && (
          <div className="mt-3 max-h-44 overflow-y-auto text-xs space-y-1">
            {results.map((r) => <div key={r.row} className={r.ok ? "text-emerald-dark" : "text-rose"}>Row {r.row}: {r.ok ? `✓ added ${r.sku}` : `✕ ${r.error}`}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
