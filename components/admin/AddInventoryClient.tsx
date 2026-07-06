"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { createProductFullAction, createCategoryJsonAction, createSubcategoryJsonAction, createStyleJsonAction, type CreateProductPayload } from "@/app/actions/catalog";
import { getProductVariantsAction, addVariantImageAction } from "@/app/actions/variants";
import { compressImage } from "@/lib/image";

type Cat = { id: string; name: string };
type Sub = { id: string; name: string; categoryId: string };
type VariantOptions = { color: string[]; size: string[]; polish: string[] };
type ColorCodeMap = Record<string, string>;
type Attr = "color" | "size" | "polish";

/** One variant row. Prices are strings so inputs stay controlled; `*Same` = inherit parent. */
type Row = {
  key: string;
  color: string; size: string; polish: string;
  sku: string; qty: string;
  wholesale: string; wholesaleSame: boolean; wholesalePublish: boolean;
  retail: string; retailSame: boolean; retailPublish: boolean;
  image: File | null; // optional per-variant photo, uploaded right after the product is created
};

const newRow = (seed: Partial<Row> = {}): Row => ({
  key: Math.random().toString(36).slice(2),
  color: "", size: "", polish: "",
  sku: "", qty: "",
  wholesale: "", wholesaleSame: false, wholesalePublish: true,
  retail: "", retailSame: false, retailPublish: true,
  image: null,
  ...seed,
});

/** Small pill toggle used for Same-as-parent / Publish columns. */
function Toggle({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} title={title} onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${on ? "bg-emerald" : "bg-sand"}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );
}

export function AddInventoryClient({
  categories,
  subcategories = [],
  styles = [],
  variantOptions = { color: [], size: [], polish: [] },
  colorCodes = {},
}: {
  categories: Cat[];
  subcategories?: Sub[];
  styles?: Sub[];
  variantOptions?: VariantOptions;
  colorCodes?: ColorCodeMap;
}) {
  const { toast } = useToast();
  const [cats, setCats] = useState<Cat[]>(categories);
  const [catId, setCatId] = useState("");
  const [newCat, setNewCat] = useState(""); const [showNewCat, setShowNewCat] = useState(false);
  // Subcategory (= "type"): filtered to the chosen category; owner can add a new one inline.
  const [subs, setSubs] = useState<Sub[]>(subcategories);
  const [subId, setSubId] = useState("");
  const [newSub, setNewSub] = useState(""); const [showNewSub, setShowNewSub] = useState(false);
  const subsForCat = subs.filter((s) => s.categoryId === catId);
  // Style (= second filter dimension: Choker, Long Necklace…): also per-category, inline-creatable.
  const [styleList, setStyleList] = useState<Sub[]>(styles);
  const [styleId, setStyleId] = useState("");
  const [newStyle, setNewStyle] = useState(""); const [showNewStyle, setShowNewStyle] = useState(false);
  const stylesForCat = styleList.filter((s) => s.categoryId === catId);

  const [name, setName] = useState("");
  const [basePrice, setBasePrice] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [sku, setSku] = useState("");
  const [type, setType] = useState<"simple" | "configurable">("simple");
  const [aiContent, setAiContent] = useState(true);

  // Parent storefront channels (a Simple product publishes via these; configurable parents too).
  const [parentRetail, setParentRetail] = useState(true);
  const [parentWholesale, setParentWholesale] = useState(true);

  // Selected master values PER attribute. Variants become the CROSS-PRODUCT of whatever is chosen,
  // so the owner can build e.g. colour × polish combinations in one go (not just one attribute).
  const [picks, setPicks] = useState<Record<Attr, string[]>>({ color: [], size: [], polish: [] });
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const input = "w-full rounded-xl border border-sand px-3.5 py-2.5 text-sm bg-white outline-none focus:border-emerald transition-colors";
  const cell = "w-full rounded-lg border border-sand bg-white px-2.5 py-1.5 text-sm outline-none focus:border-emerald transition-colors";

  // ----- master option list for the chosen attribute (colours come ONLY from master; #17) -----
  const masterFor = (a: Attr): string[] => {
    if (a === "color") {
      const m = new Map<string, string>();
      for (const c of variantOptions.color ?? []) { const t = c.trim(); if (t) m.set(t.toLowerCase(), t); }
      for (const k of Object.keys(colorCodes ?? {})) { const t = k.trim(); if (t && !m.has(t.toLowerCase())) m.set(t.toLowerCase(), t.charAt(0).toUpperCase() + t.slice(1)); }
      return [...m.values()].sort((x, y) => x.localeCompare(y));
    }
    return [...new Set((variantOptions[a] ?? []).map((s) => s.trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
  };
  const masters = useMemo(() => ({ color: masterFor("color"), size: masterFor("size"), polish: masterFor("polish") }), [variantOptions, colorCodes]);
  const filterOpts = (a: Attr) => (q.trim() ? masters[a].filter((o) => o.toLowerCase().includes(q.trim().toLowerCase())) : masters[a]);
  // How many variant rows the current selection will produce (product of each chosen attribute's count).
  const comboCount = (["color", "size", "polish"] as Attr[]).reduce((n, a) => (picks[a].length ? n * picks[a].length : n), 1);
  const anyPicked = (["color", "size", "polish"] as Attr[]).some((a) => picks[a].length > 0);

  const catName = cats.find((c) => c.id === catId)?.name;

  /** SKU/barcode preview — mirrors the server autoSku so what you see prints later. */
  const previewSku = (r: Row): string => {
    const parent = (sku.trim() || "BD####").toUpperCase();
    if (r.sku.trim()) return r.sku.trim().toUpperCase().replace(/\s+/g, "-");
    const code = (val: string, master?: ColorCodeMap) =>
      val.trim() ? (master?.[val.trim().toLowerCase()] ?? val.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)) : null;
    const suffix = [code(r.color, colorCodes), code(r.size), code(r.polish)].filter(Boolean).join("-") || "VAR";
    return `${parent}-${suffix}`;
  };

  function togglePick(a: Attr, v: string) {
    const lc = v.toLowerCase();
    setPicks((p) => {
      const cur = p[a];
      const next = cur.some((x) => x.toLowerCase() === lc) ? cur.filter((x) => x.toLowerCase() !== lc) : [...cur, v];
      return { ...p, [a]: next };
    });
  }

  /** Generate a variant row for every COMBINATION of the selected colours, sizes & polishes
   *  (the cross-product). Existing rows with the same colour+size+polish are preserved, so
   *  re-generating never wipes entered prices/stock. */
  function generateRows() {
    const dims = (["color", "size", "polish"] as Attr[])
      .map((a) => ({ a, vals: picks[a] }))
      .filter((d) => d.vals.length > 0);
    if (dims.length === 0) { toast("Select at least one colour, size or polish", "error"); return; }
    // Cartesian product of the chosen attributes.
    let combos: Partial<Record<Attr, string>>[] = [{}];
    for (const d of dims) {
      const next: Partial<Record<Attr, string>>[] = [];
      for (const c of combos) for (const v of d.vals) next.push({ ...c, [d.a]: v });
      combos = next;
    }
    const total = Math.max(0, Number(initialStock) || 0);
    const per = combos.length ? Math.floor(total / combos.length) : 0;
    const eq = (x?: string, y?: string) => (x || "").toLowerCase() === (y || "").toLowerCase();
    setRows((prev) => combos.map((combo) => {
      const existing = prev.find((r) => eq(r.color, combo.color) && eq(r.size, combo.size) && eq(r.polish, combo.polish));
      if (existing) return existing;
      return newRow({ qty: per ? String(per) : "", color: combo.color || "", size: combo.size || "", polish: combo.polish || "" });
    }));
    toast(`Built ${combos.length} variant${combos.length === 1 ? "" : "s"} — set stock, price & publishing`);
  }

  const updateRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const fileToB64 = (f: File) => new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = rej; r.readAsDataURL(f);
  });

  function validate(): string | null {
    if (!catId) return "Choose a category first.";
    if (!name.trim()) return "Add a product name.";
    if (!(Number(basePrice) > 0)) return "Base wholesale price must be greater than 0.";
    if (type === "simple") {
      if ((Number(initialStock) || 0) < 0) return "Initial stock cannot be negative.";
      return null;
    }
    const real = rows.filter((r) => r.color.trim() || r.size.trim() || r.polish.trim());
    if (real.length === 0) return "Add at least one variant, or switch to a Simple product.";
    for (const r of real) if ((Number(r.qty) || 0) < 0) return "Variant stock cannot be negative.";
    const skus = real.map((r) => (r.sku.trim() ? r.sku.trim().toUpperCase() : previewSku(r)));
    const dup = skus.find((s, i) => skus.indexOf(s) !== i);
    if (dup) return `Duplicate variant SKU "${dup}" — make each one unique.`;
    return null;
  }

  async function save(mode: "draft" | "publish") {
    const err = validate();
    if (err) { toast(err, "error"); return; }
    setBusy(true);
    try {
      const real = rows.filter((r) => r.color.trim() || r.size.trim() || r.polish.trim());
      const payload: CreateProductPayload = {
        name: name.trim(),
        categoryId: catId,
        subcategoryId: subId || undefined,
        styleId: styleId || undefined,
        basePriceRupees: Number(basePrice),
        initialStock: Math.max(0, Number(initialStock) || 0),
        manualSku: sku.trim() || undefined,
        type,
        aiContent,
        retailPublish: parentRetail,
        wholesalePublish: parentWholesale,
        mode,
        variants: type === "configurable" ? real.map((r) => ({
          color: r.color.trim() || undefined,
          size: r.size.trim() || undefined,
          polish: r.polish.trim() || undefined,
          sku: r.sku.trim() || undefined,
          qty: Number(r.qty) || 0,
          wholesaleRupees: r.wholesaleSame ? null : (r.wholesale ? Number(r.wholesale) : null),
          retailRupees: r.retailSame ? null : (r.retail ? Number(r.retail) : null),
          retailPublish: r.retailPublish,
          wholesalePublish: r.wholesalePublish,
        })) : undefined,
      };

      const f = fileRef.current?.files?.[0] ?? null;
      if (f) {
        const small = await compressImage(f);
        payload.rawImageBase64 = await fileToB64(small);
        payload.rawImageMime = small.type || "image/jpeg";
      }

      const res = await createProductFullAction(payload);
      if (!res.ok) { toast(res.error ?? "Could not create product", "error"); return; }

      // Attach any per-variant photos: resolve the freshly-created variants by SKU, match each
      // editor row by colour/size/polish, and upload its photo to that variant. Best-effort —
      // a failed match just skips that photo (the owner can add it from the Variants tab).
      if (type === "configurable" && res.sku) {
        const withPhotos = real.filter((r) => r.image);
        if (withPhotos.length) {
          try {
            const created = await getProductVariantsAction(res.sku);
            const norm = (x?: string | null) => (x ?? "").trim().toLowerCase();
            for (const row of withPhotos) {
              const match = created.find((cv) => norm(cv.color) === norm(row.color) && norm(cv.size) === norm(row.size) && norm(cv.polish) === norm(row.polish));
              if (!match || !row.image) continue;
              const img = await compressImage(row.image);
              const vfd = new FormData();
              vfd.set("id", match.id);
              vfd.set("product_sku", res.sku);
              vfd.append("images", img);
              await addVariantImageAction(vfd);
            }
          } catch { /* best-effort — never block on variant photos */ }
        }
      }

      toast(`${res.sku} ${mode === "publish" ? "created & published" : "saved as draft"} ✓`);
      // Save & continue → clear for the next product. Save draft → keep nothing lingering either.
      setName(""); setBasePrice(""); setInitialStock(""); setSku(""); setType("simple"); setSubId(""); setStyleId("");
      setPicks({ color: [], size: [], polish: [] }); setRows([]); setQ("");
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "error");
    } finally { setBusy(false); }
  }

  async function createCat() {
    const nm = newCat.trim(); if (!nm) return;
    setBusy(true);
    const res = await createCategoryJsonAction(nm);
    setBusy(false);
    if (res) { setCats((c) => [...c, res]); setCatId(res.id); setSubId(""); setStyleId(""); setNewCat(""); setShowNewCat(false); toast(`Category “${res.name}” created`); }
    else toast("Couldn't create category", "error");
  }

  async function createSub() {
    const nm = newSub.trim();
    if (!nm) return;
    if (!catId) { toast("Pick a category first", "error"); return; }
    setBusy(true);
    const res = await createSubcategoryJsonAction(nm, catId);
    setBusy(false);
    if (res) { setSubs((s) => [...s, res]); setSubId(res.id); setNewSub(""); setShowNewSub(false); toast(`Subcategory “${res.name}” created`); }
    else toast("Couldn't create subcategory", "error");
  }

  async function createStyle() {
    const nm = newStyle.trim();
    if (!nm) return;
    if (!catId) { toast("Pick a category first", "error"); return; }
    setBusy(true);
    const res = await createStyleJsonAction(nm, catId);
    setBusy(false);
    if (res) { setStyleList((s) => [...s, res]); setStyleId(res.id); setNewStyle(""); setShowNewStyle(false); toast(`Style “${res.name}” created`); }
    else toast("Couldn't create style", "error");
  }

  const real = rows.filter((r) => r.color.trim() || r.size.trim() || r.polish.trim());
  const stockTotal = real.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const attrLabel: Record<Attr, string> = { color: "colours", size: "sizes", polish: "polishes" };

  return (
    <div className="w-full max-w-[1200px] mx-auto space-y-5">
      {/* ============ BASIC INFORMATION ============ */}
      <section className="bg-white rounded-2xl p-6 shadow-card">
        <h2 className="text-base font-semibold text-ink mb-4">Basic information</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-medium text-muted">Product name <span className="text-rose">*</span></label>
            <input className={`${input} mt-1`} placeholder="e.g. Rajwada Kundan Bracelet" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Category <span className="text-rose">*</span></label>
            <div className="flex gap-1.5 mt-1">
              <select className={input} value={catId} onChange={(e) => { setCatId(e.target.value); setSubId(""); setStyleId(""); }}>
                <option value="">Select…</option>
                {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button type="button" onClick={() => setShowNewCat((v) => !v)} className="px-3 rounded-xl border border-emerald text-emerald text-sm whitespace-nowrap hover:bg-emerald-mist">+ New</button>
            </div>
            {/* Subcategory — filtered to the chosen category, with inline create (e.g. Bracelet → Kundan Bracelets). */}
            {catId && (
              <>
                <div className="flex gap-1.5 mt-1.5">
                  <select className={input} value={subId} onChange={(e) => setSubId(e.target.value)}>
                    <option value="">No subcategory</option>
                    {subsForCat.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewSub((v) => !v)} className="px-3 rounded-xl border border-emerald text-emerald text-sm whitespace-nowrap hover:bg-emerald-mist">+ Sub</button>
                </div>
                {showNewSub && (
                  <div className="flex gap-1.5 mt-1.5">
                    <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="New subcategory name" className={input} />
                    <button type="button" onClick={createSub} disabled={busy} className="px-3 rounded-xl bg-ink text-white text-sm whitespace-nowrap disabled:opacity-50">Create</button>
                  </div>
                )}
                {/* Style — the 2nd filter dimension (Choker, Long Necklace, Round Neck Set…), inline-creatable. */}
                <div className="flex gap-1.5 mt-1.5">
                  <select className={input} value={styleId} onChange={(e) => setStyleId(e.target.value)} title="Style (e.g. Choker, Long Necklace)">
                    <option value="">No style</option>
                    {stylesForCat.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                  <button type="button" onClick={() => setShowNewStyle((v) => !v)} className="px-3 rounded-xl border border-emerald text-emerald text-sm whitespace-nowrap hover:bg-emerald-mist">+ Style</button>
                </div>
                {showNewStyle && (
                  <div className="flex gap-1.5 mt-1.5">
                    <input value={newStyle} onChange={(e) => setNewStyle(e.target.value)} placeholder="New style (e.g. Choker)" className={input} />
                    <button type="button" onClick={createStyle} disabled={busy} className="px-3 rounded-xl bg-ink text-white text-sm whitespace-nowrap disabled:opacity-50">Create</button>
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Base wholesale price (₹) <span className="text-rose">*</span></label>
            <input className={`${input} mt-1`} inputMode="numeric" placeholder="e.g. 1250" value={basePrice} onChange={(e) => setBasePrice(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Initial stock {type === "configurable" && real.length > 0 ? <span className="text-muted/70">(auto {stockTotal})</span> : <span className="text-rose">*</span>}</label>
            <input className={`${input} mt-1`} inputMode="numeric" placeholder="e.g. 50"
              value={type === "configurable" && real.length > 0 ? String(stockTotal) : initialStock}
              disabled={type === "configurable" && real.length > 0}
              onChange={(e) => setInitialStock(e.target.value)} />
          </div>
        </div>

        {showNewCat && (
          <div className="flex gap-2 mt-3">
            <input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" className={input} />
            <button type="button" onClick={createCat} disabled={busy} className="px-4 rounded-xl bg-ink text-white text-sm whitespace-nowrap disabled:opacity-50">Create</button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
          <div>
            <label className="text-xs font-medium text-muted">SKU (optional)</label>
            <input className={`${input} mt-1 font-mono`} placeholder="Auto-generate if left blank" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted">Product type <span className="text-rose">*</span></label>
            <select className={`${input} mt-1`} value={type} onChange={(e) => setType(e.target.value as "simple" | "configurable")}>
              <option value="simple">Simple (one item)</option>
              <option value="configurable">Configurable (variants)</option>
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink xl:col-span-2 mt-1 cursor-pointer">
            <input type="checkbox" checked={aiContent} onChange={(e) => setAiContent(e.target.checked)} className="accent-emerald mt-0.5" />
            <span><b>Let AI write product content</b><br /><span className="text-xs text-muted">AI will generate description, tags, SEO etc.</span></span>
          </label>
        </div>

        {/* Parent storefront channels */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-4 border-t border-sand">
          <span className="text-xs font-medium text-muted">Publish this product to:</span>
          <label className="flex items-center gap-2 text-sm text-ink"><Toggle on={parentRetail} onClick={() => setParentRetail((v) => !v)} /> Retail storefront</label>
          <label className="flex items-center gap-2 text-sm text-ink"><Toggle on={parentWholesale} onClick={() => setParentWholesale((v) => !v)} /> Wholesale portal</label>
          <span className="text-xs text-muted">Use <b>Save &amp; continue</b> to publish, or <b>Save draft</b> to keep hidden.</span>
        </div>
      </section>

      {/* ============ VARIANT WIZARD (configurable only) ============ */}
      {type === "configurable" && (
        <section className="bg-white rounded-2xl p-6 shadow-card">
          <div>
            <p className="text-sm font-semibold text-ink"><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald text-white text-xs mr-2">1</span>Pick the colours, sizes &amp; polishes for this design</p>
            <p className="text-xs text-muted mt-1">Select values under any of these — you can combine them. If you choose more than one attribute we create a variant for every combination (e.g. 2 colours × 2 polishes = 4 variants). Choose from existing master values only.</p>
            <input className={`${input} mt-3`} placeholder="🔎 Search options…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(["color", "size", "polish"] as Attr[]).map((a) => {
                const opts = filterOpts(a);
                return (
                  <div key={a} className="rounded-xl border border-sand p-3">
                    <p className="text-xs font-semibold text-ink capitalize mb-2">
                      {a === "polish" ? "Polish / Finish" : a}
                      {picks[a].length > 0 && <span className="ml-1 text-emerald-dark font-normal">· {picks[a].length} selected</span>}
                    </p>
                    <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5 pr-1">
                      {masters[a].length === 0 && <p className="text-[11px] text-muted py-1">No {attrLabel[a]} in master yet — add them under <Link href="/admin/colours" className="text-emerald nav-link">master data</Link>.</p>}
                      {opts.map((o) => {
                        const on = picks[a].some((x) => x.toLowerCase() === o.toLowerCase());
                        return (
                          <button key={o} type="button" onClick={() => togglePick(a, o)}
                            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${on ? "border-emerald bg-emerald text-white" : "border-sand text-muted hover:border-emerald"}`}>
                            {on ? "✓ " : ""}{o}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {anyPicked && (
              <button type="button" onClick={generateRows} className="mt-3 px-4 py-2 rounded-xl bg-ink text-white text-sm">Generate {comboCount} variant{comboCount === 1 ? "" : "s"} →</button>
            )}
          </div>

          {/* ---- Variants table ---- */}
          {rows.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-semibold text-ink mb-1"><span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald text-white text-xs mr-2">3</span>Variants</p>
              <p className="text-xs text-muted mb-3">Fill stock, pricing and publish settings for wholesale &amp; retail. A blank price with <b>Same</b> on inherits the parent price.</p>
              <div className="overflow-x-auto rounded-xl border border-sand">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-cream text-[11px] uppercase tracking-wide text-muted">
                      <th className="text-left font-medium px-3 py-2">Variant</th>
                      <th className="text-left font-medium px-3 py-2">SKU</th>
                      <th className="text-center font-medium px-3 py-2">Stock *</th>
                      <th className="text-center font-medium px-3 py-2 border-l border-sand" colSpan={3}>Wholesale</th>
                      <th className="text-center font-medium px-3 py-2 border-l border-sand" colSpan={3}>Retail</th>
                      <th className="px-2 py-2" />
                    </tr>
                    <tr className="bg-cream/60 text-[10px] uppercase tracking-wide text-muted/80">
                      <th /><th /><th />
                      <th className="font-normal px-2 py-1 border-l border-sand">Price ₹</th><th className="font-normal px-2 py-1">Same</th><th className="font-normal px-2 py-1">Publish</th>
                      <th className="font-normal px-2 py-1 border-l border-sand">Price ₹</th><th className="font-normal px-2 py-1">Same</th><th className="font-normal px-2 py-1">Publish</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={r.key} className="border-t border-sand/70">
                        <td className="px-3 py-2 capitalize text-ink whitespace-nowrap">{[r.color, r.size, r.polish].filter(Boolean).join(" · ") || <span className="text-muted">—</span>}</td>
                        <td className="px-3 py-2"><input className={`${cell} font-mono`} placeholder={previewSku(r)} value={r.sku} onChange={(e) => updateRow(i, { sku: e.target.value })} /></td>
                        <td className="px-2 py-2 w-20"><input className={`${cell} text-center`} type="number" min={0} step={1} placeholder="0" value={r.qty} onChange={(e) => updateRow(i, { qty: e.target.value })} /></td>
                        {/* Wholesale */}
                        <td className="px-2 py-2 w-24 border-l border-sand"><input className={`${cell} text-right`} type="number" min={0} step="0.01" placeholder={r.wholesaleSame ? "parent" : "—"} value={r.wholesaleSame ? "" : r.wholesale} disabled={r.wholesaleSame} onChange={(e) => updateRow(i, { wholesale: e.target.value })} /></td>
                        <td className="px-2 py-2 text-center"><Toggle on={r.wholesaleSame} onClick={() => updateRow(i, { wholesaleSame: !r.wholesaleSame })} title="Same as parent" /></td>
                        <td className="px-2 py-2 text-center"><Toggle on={r.wholesalePublish} onClick={() => updateRow(i, { wholesalePublish: !r.wholesalePublish })} title="Publish to wholesale" /></td>
                        {/* Retail */}
                        <td className="px-2 py-2 w-24 border-l border-sand"><input className={`${cell} text-right`} type="number" min={0} step="0.01" placeholder={r.retailSame ? "parent" : "—"} value={r.retailSame ? "" : r.retail} disabled={r.retailSame} onChange={(e) => updateRow(i, { retail: e.target.value })} /></td>
                        <td className="px-2 py-2 text-center"><Toggle on={r.retailSame} onClick={() => updateRow(i, { retailSame: !r.retailSame })} title="Same as parent" /></td>
                        <td className="px-2 py-2 text-center"><Toggle on={r.retailPublish} onClick={() => updateRow(i, { retailPublish: !r.retailPublish })} title="Publish to retail" /></td>
                        <td className="px-2 py-2 text-center whitespace-nowrap">
                          <label className="cursor-pointer text-base mr-1.5 align-middle" title={r.image ? `Photo: ${r.image.name}` : "Add a photo for this variant (uploaded after save)"}>
                            {r.image ? "🖼️" : "📷"}
                            <input type="file" accept="image/*" className="hidden" onChange={(e) => updateRow(i, { image: e.target.files?.[0] ?? null })} />
                          </label>
                          <button type="button" onClick={() => removeRow(i)} className="text-muted hover:text-rose align-middle" title="Remove">🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between mt-2">
                <button type="button" onClick={() => setRows((rs) => [...rs, newRow()])} className="px-3 py-1.5 rounded-full border border-sand text-sm text-ink hover:border-emerald">+ Add variant</button>
                <p className="text-[11px] text-muted">{real.length} variant{real.length === 1 ? "" : "s"} · total stock <b className="text-ink">{stockTotal}</b> pcs</p>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ============ PHOTO ============ */}
      <section className="bg-white rounded-2xl p-6 shadow-card">
        <label className="text-sm font-semibold text-ink">Raw product photo <span className="text-muted font-normal text-xs">(optional)</span></label>
        <p className="text-xs text-muted mb-2">Upload a raw design image. After saving, generate professional AI model photos from the product page.</p>
        <input ref={fileRef} type="file" accept="image/*" className="block w-full text-sm text-ink file:mr-3 file:rounded-full file:border-0 file:bg-emerald file:text-white file:px-4 file:py-2 file:text-sm file:cursor-pointer" />
      </section>

      {/* ============ SAVE BAR ============ */}
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 bg-cream/80 backdrop-blur rounded-2xl border border-sand px-4 py-3">
        <Link href="/admin/catalogue" className="px-4 py-2 rounded-xl text-sm text-muted hover:text-ink">Cancel</Link>
        <button type="button" onClick={() => save("draft")} disabled={busy} className="px-5 py-2 rounded-xl border border-ink text-ink text-sm font-medium hover:bg-ink hover:text-white disabled:opacity-50">{busy ? "Saving…" : "Save draft"}</button>
        <button type="button" onClick={() => save("publish")} disabled={busy} className="px-5 py-2 rounded-xl bg-emerald text-white text-sm font-medium hover:bg-emerald-dark disabled:opacity-50">{busy ? "Saving…" : "Save & continue"}</button>
      </div>
    </div>
  );
}
