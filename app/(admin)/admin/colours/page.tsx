export const dynamic = "force-dynamic";
import Link from "next/link";
import { getOptionMaster } from "@/lib/supabase/queries";
import { addOptionAction, updateOptionAction, deleteOptionAction } from "@/app/actions/options";
import { SeedColoursButton } from "@/components/admin/SeedColoursButton";

export const metadata = { title: "Owner Console · Colours & Options" };

const inp = "rounded-lg border border-sand px-2.5 py-1.5 text-sm bg-white outline-none focus:border-emerald";
const codeInp = `${inp} font-mono w-24 uppercase text-[12px]`;

type SortKey = "default" | "az" | "za" | "usage";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "default", label: "Catalog order" },
  { key: "az", label: "A → Z" },
  { key: "za", label: "Z → A" },
  { key: "usage", label: "Most used first" },
];

/** Filter + sort the master list per the URL params. */
function arrange<T extends { value: string; count: number }>(rows: T[], q: string, sort: SortKey): T[] {
  const needle = q.trim().toLowerCase();
  let out = needle ? rows.filter((r) => r.value.toLowerCase().includes(needle)) : rows.slice();
  if (sort === "az") out = out.sort((a, b) => a.value.localeCompare(b.value, "en", { sensitivity: "base" }));
  else if (sort === "za") out = out.sort((a, b) => b.value.localeCompare(a.value, "en", { sensitivity: "base" }));
  else if (sort === "usage") out = out.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return out;
}

export default async function ColoursPage({ searchParams }: { searchParams: { q?: string; sort?: string } }) {
  const { color, size, polish } = await getOptionMaster();
  const q = searchParams.q ?? "";
  const sort = (SORTS.find((s) => s.key === (searchParams.sort ?? ""))?.key ?? "default") as SortKey;
  const colourRows = arrange(color as any[], q, sort);
  const sizeRows = arrange(size as any[], q, sort === "usage" ? "usage" : sort);
  const polishRows = arrange(polish as any[], q, sort === "usage" ? "usage" : sort);

  // Sanity flags surfaced to the owner.
  const codeMap = new Map<string, string[]>();
  for (const c of color as any[]) {
    if (!c.barcode_code) continue;
    const arr = codeMap.get(c.barcode_code) ?? [];
    arr.push(c.value); codeMap.set(c.barcode_code, arr);
  }
  const duplicates = [...codeMap.entries()].filter(([, names]) => names.length > 1);
  const missingCode = (color as any[]).filter((c) => !c.barcode_code).map((c) => c.value);
  const seededCount = (color as any[]).filter((c) => c.barcode_code).length;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h1 className="font-display text-4xl text-ink">Colours &amp; Options</h1>
        <SeedColoursButton seeded={seededCount} total={(color as any[]).length} />
      </div>
      <p className="text-sm text-muted mb-5">Your master list of colours, sizes and polishes. Each colour carries a <b>barcode code</b> (RED, MULTI1, SBLUE…) that prints on every variant&apos;s label — when you add a variant, the SKU auto-generates as <code className="bg-cream px-1 rounded">{`{productSKU}-{barcode code}`}</code>. Rename, set a swatch, or remove — every variant using it updates instantly.</p>

      {/* Filter / sort bar */}
      <form action="/admin/colours" className="flex flex-wrap items-center gap-2 mb-4">
        <input name="q" defaultValue={q} placeholder="Search colour / size / polish…" className="rounded-full border border-sand px-4 py-1.5 text-sm bg-white outline-none focus:border-emerald w-64" />
        <div className="flex gap-1 bg-cream rounded-full p-1">
          {SORTS.map((s) => (
            <Link key={s.key} href={`/admin/colours?${new URLSearchParams({ ...(q ? { q } : {}), sort: s.key }).toString()}`}
              className={`px-3 py-1 rounded-full text-xs whitespace-nowrap ${sort === s.key ? "bg-ink text-white" : "text-muted hover:text-ink"}`}>
              {s.label}
            </Link>
          ))}
        </div>
        <button className="px-3 py-1.5 rounded-full bg-ink text-white text-xs">Apply</button>
        {(q || sort !== "default") && <Link href="/admin/colours" className="text-xs text-muted hover:text-ink">Clear</Link>}
      </form>

      {/* Data-integrity hints */}
      {(duplicates.length > 0 || missingCode.length > 0) && (
        <div className="rounded-2xl border border-gold/40 bg-gold/5 p-4 mb-5 text-xs text-gold-dark space-y-1">
          {duplicates.length > 0 && (
            <p>⚠️ <b>Duplicate barcode codes:</b> {duplicates.map(([code, names]) => `${code} → ${names.join(" + ")}`).join("; ")}. Two colours with the same code will produce the same barcode for both — change one to keep scans unambiguous.</p>
          )}
          {missingCode.length > 0 && (
            <p>ℹ️ <b>No code set for:</b> {missingCode.slice(0, 8).join(", ")}{missingCode.length > 8 ? ` …and ${missingCode.length - 8} more` : ""}. The system will derive one from the name, but you can pin a specific code below.</p>
          )}
        </div>
      )}

      {/* ---- COLOURS ---- */}
      <section className="bg-white rounded-2xl shadow-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-ink">Colours <span className="text-muted text-sm">({colourRows.length}{q || sort !== "default" ? ` of ${color.length}` : ""})</span></h2>
        </div>

        {/* Header row hidden on narrow screens to keep things readable. */}
        <div className="hidden md:grid grid-cols-[2.5rem_1fr_8rem_3rem_auto] gap-2 text-[10px] uppercase tracking-wide text-muted px-1 mb-1">
          <span>Swatch</span><span>Colour</span><span>Barcode code</span><span className="text-right">Used</span><span aria-hidden />
        </div>

        <div className="space-y-2 mb-4">
          {colourRows.map((c: any) => (
            <form key={c.value} action={updateOptionAction} className="grid grid-cols-[2.5rem_1fr_8rem_3rem_auto] gap-2 items-center rounded-xl border border-sand p-2">
              <input type="hidden" name="kind" value="color" />
              <input type="hidden" name="old_value" value={c.value} />
              <input type="color" name="hex" defaultValue={c.hex ?? "#cccccc"} title="Swatch colour" className="h-8 w-8 rounded cursor-pointer border border-sand bg-white p-0" />
              <input name="value" defaultValue={c.value} className={`${inp} min-w-0`} />
              <input name="barcode_code" defaultValue={c.barcode_code ?? ""} placeholder="auto" title="Barcode suffix — prints on label as {productSKU}-{code}" className={codeInp} maxLength={12} />
              <span className={`text-[11px] text-right whitespace-nowrap ${c.count > 0 ? "text-ink" : "text-muted"}`} title="Variants using this colour">{c.count}×</span>
              <div className="flex items-center gap-1.5 justify-end">
                <button className="px-2.5 py-1 rounded-lg bg-ink/5 text-ink text-xs hover:bg-ink/10">Save</button>
                <button formAction={deleteOptionAction} className="text-muted hover:text-rose text-xs px-1" title="Remove from list">✕</button>
              </div>
            </form>
          ))}
          {colourRows.length === 0 && (
            <p className="text-sm text-muted py-4">
              {q ? <>No colour matches “{q}”. <Link href="/admin/colours" className="text-emerald nav-link">Clear search</Link>.</> : <>No colours yet — add your first below, or click <b>Seed canonical 75</b> at the top.</>}
            </p>
          )}
        </div>

        <form action={addOptionAction} className="flex flex-wrap items-end gap-2 border-t border-sand/60 pt-3">
          <input type="hidden" name="kind" value="color" />
          <label className="text-[11px] text-muted">Swatch<input type="color" name="hex" defaultValue="#D4AF37" className="h-9 w-12 block mt-0.5 rounded cursor-pointer border border-sand bg-white p-0" /></label>
          <label className="text-[11px] text-muted">New colour<input name="value" placeholder="e.g. Rani Pink" className={`${inp} w-44 block mt-0.5`} /></label>
          <label className="text-[11px] text-muted">Barcode code<input name="barcode_code" placeholder="e.g. RPINK" className={`${codeInp} block mt-0.5`} maxLength={12} /></label>
          <button className="btn-primary px-4 py-2 text-sm font-medium">+ Add colour</button>
        </form>
      </section>

      {/* ---- SIZES & POLISH ---- */}
      <div className="grid md:grid-cols-2 gap-6">
        <OptionList kind="size" title="Sizes" rows={sizeRows} all={size as any[]} searching={!!q || sort !== "default"} />
        <OptionList kind="polish" title="Polishes / finishes" rows={polishRows} all={polish as any[]} searching={!!q || sort !== "default"} />
      </div>
    </main>
  );
}

function OptionList({ kind, title, rows, all, searching }: { kind: "size" | "polish"; title: string; rows: any[]; all: any[]; searching: boolean }) {
  return (
    <section className="bg-white rounded-2xl shadow-card p-5">
      <h2 className="font-medium text-ink mb-3">{title} <span className="text-muted text-sm">({rows.length}{searching ? ` of ${all.length}` : ""})</span></h2>
      <div className="space-y-2 mb-4">
        {rows.map((r) => (
          <form key={r.value} action={updateOptionAction} className="flex items-center gap-2">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="old_value" value={r.value} />
            <input name="value" defaultValue={r.value} className={`${inp} flex-1 min-w-0`} />
            <span className="text-[11px] text-muted whitespace-nowrap">{r.count}×</span>
            <button className="px-2.5 py-1 rounded-lg bg-ink/5 text-ink text-xs hover:bg-ink/10">Save</button>
            <button formAction={deleteOptionAction} className="text-muted hover:text-rose text-xs px-1">✕</button>
          </form>
        ))}
        {rows.length === 0 && <p className="text-sm text-muted">{searching ? "No matches." : "None yet."}</p>}
      </div>
      <form action={addOptionAction} className="flex items-end gap-2 border-t border-sand/60 pt-3">
        <input type="hidden" name="kind" value={kind} />
        <input name="value" placeholder={`Add ${title.toLowerCase().replace(/s$/, "")}`} className={`${inp} flex-1`} />
        <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">+ Add</button>
      </form>
    </section>
  );
}
