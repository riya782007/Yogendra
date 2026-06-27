export const dynamic = "force-dynamic";
import { getOptionMaster } from "@/lib/supabase/queries";
import { addOptionAction, updateOptionAction, deleteOptionAction } from "@/app/actions/options";

export const metadata = { title: "Owner Console · Colours & Options" };

const inp = "rounded-lg border border-sand px-2.5 py-1.5 text-sm bg-white outline-none focus:border-emerald";

export default async function ColoursPage() {
  const { color, size, polish } = await getOptionMaster();

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Colours &amp; Options</h1>
      <p className="text-sm text-muted mb-6">Your master list of colours, sizes and polishes. Rename to fix a typo everywhere (it updates every product using it), set a colour swatch, or remove ones you don&apos;t use.</p>

      {/* ---- COLOURS ---- */}
      <section className="bg-white rounded-2xl shadow-card p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium text-ink">Colours <span className="text-muted text-sm">({color.length})</span></h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
          {color.map((c) => (
            <form key={c.value} action={updateOptionAction} className="flex items-center gap-2 rounded-xl border border-sand p-2">
              <input type="hidden" name="kind" value="color" />
              <input type="hidden" name="old_value" value={c.value} />
              <input type="color" name="hex" defaultValue={c.hex ?? "#cccccc"} title="Swatch colour" className="h-8 w-8 shrink-0 rounded cursor-pointer border border-sand bg-white p-0" />
              <input name="value" defaultValue={c.value} className={`${inp} flex-1 min-w-0`} />
              <span className="text-[11px] text-muted whitespace-nowrap" title="Variants using this colour">{c.count}×</span>
              <button className="px-2.5 py-1 rounded-lg bg-ink/5 text-ink text-xs hover:bg-ink/10">Save</button>
              <button formAction={deleteOptionAction} className="text-muted hover:text-rose text-xs px-1" title="Remove from list">✕</button>
            </form>
          ))}
          {color.length === 0 && <p className="text-sm text-muted">No colours yet — add your first below.</p>}
        </div>

        <form action={addOptionAction} className="flex flex-wrap items-end gap-2 border-t border-sand/60 pt-3">
          <input type="hidden" name="kind" value="color" />
          <label className="text-[11px] text-muted">Swatch<input type="color" name="hex" defaultValue="#D4AF37" className="h-9 w-12 block mt-0.5 rounded cursor-pointer border border-sand bg-white p-0" /></label>
          <label className="text-[11px] text-muted">New colour<input name="value" placeholder="e.g. Rani Pink" className={`${inp} w-44 block mt-0.5`} /></label>
          <button className="btn-primary px-4 py-2 text-sm font-medium">+ Add colour</button>
        </form>
      </section>

      {/* ---- SIZES & POLISH ---- */}
      <div className="grid md:grid-cols-2 gap-6">
        <OptionList kind="size" title="Sizes" rows={size} />
        <OptionList kind="polish" title="Polishes / finishes" rows={polish} />
      </div>
    </main>
  );
}

function OptionList({ kind, title, rows }: { kind: "size" | "polish"; title: string; rows: { value: string; count: number }[] }) {
  return (
    <section className="bg-white rounded-2xl shadow-card p-5">
      <h2 className="font-medium text-ink mb-3">{title} <span className="text-muted text-sm">({rows.length})</span></h2>
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
        {rows.length === 0 && <p className="text-sm text-muted">None yet.</p>}
      </div>
      <form action={addOptionAction} className="flex items-end gap-2 border-t border-sand/60 pt-3">
        <input type="hidden" name="kind" value={kind} />
        <input name="value" placeholder={`Add ${title.toLowerCase().replace(/s$/, "")}`} className={`${inp} flex-1`} />
        <button className="px-3 py-2 rounded-xl bg-ink/5 text-ink text-sm hover:bg-ink/10">+ Add</button>
      </form>
    </section>
  );
}
