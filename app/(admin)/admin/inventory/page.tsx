export const dynamic = "force-dynamic";
import Link from "next/link";
import { getInventoryClassified } from "@/lib/supabase/queries";
import { Pager } from "@/components/admin/Pager";
import { StockAdjust } from "@/components/admin/StockAdjust";
import { getSession, can } from "@/lib/auth";
import { setProductVisibilityAction } from "@/app/actions/catalog";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";

const BADGE: Record<string, string> = {
  dead: "bg-rose/15 text-rose", low: "bg-gold/15 text-gold-dark",
  inactive: "bg-cream text-muted", healthy: "bg-emerald-mist text-emerald-dark",
};
const PAGE_SIZE = 25;

function daysSince(iso: string | null) {
  if (!iso) return "never";
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) + "d ago";
}

export default async function Inventory({ searchParams }: { searchParams: { deadDays?: string; lowQty?: string; cls?: string; q?: string; page?: string } }) {
  const deadDays = Math.max(1, parseInt(searchParams.deadDays ?? "30", 10) || 30);
  const lowQty = Math.max(0, parseInt(searchParams.lowQty ?? "2", 10) || 2);
  const cls = searchParams.cls ?? "";
  const q = (searchParams.q ?? "").toLowerCase().trim();
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);

  const rows = await getInventoryClassified({ deadDays, lowQty });
  const session = getSession();
  const counts = rows.reduce((a, r) => { a[r.cls] = (a[r.cls] ?? 0) + 1; return a; }, {} as Record<string, number>);
  const filtered = rows.filter((r) => (!cls || r.cls === cls) && (!q || (r.name + r.sku).toLowerCase().includes(q)));
  const total = filtered.length;
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Inventory Intelligence</h1>
      <p className="text-sm text-muted mb-5">Rule: <b>Dead</b> = no movement in <b>{deadDays}</b> days · <b>Low</b> = ≤ <b>{lowQty}</b> pcs · <b>Inactive</b> = never sold or moved even once (checked first — an item can only be Dead or Low once it's had at least one movement). Change the numbers below and the classification updates live.</p>

      <StockAdjust />

      <form className="flex flex-wrap items-end gap-3 mb-4 bg-white rounded-2xl p-4 shadow-card border border-sand">
        <label className="text-sm text-muted">Dead after (days)
          <input name="deadDays" defaultValue={deadDays} type="number" className="mt-1 block w-28 rounded-xl border border-sand px-3 py-2 text-ink" />
        </label>
        <label className="text-sm text-muted">Low at or below (pcs)
          <input name="lowQty" defaultValue={lowQty} type="number" className="mt-1 block w-28 rounded-xl border border-sand px-3 py-2 text-ink" />
        </label>
        <input name="q" defaultValue={searchParams.q ?? ""} placeholder="Search name or SKU…" className="flex-1 min-w-[160px] rounded-xl border border-sand px-4 py-2 text-sm outline-none focus:border-emerald" />
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Apply</button>
      </form>

      <div className="flex flex-wrap gap-2 mb-4">
        {["dead", "low", "inactive", "healthy"].map((c) => (
          <Link key={c} href={`/admin/inventory?deadDays=${deadDays}&lowQty=${lowQty}&cls=${c}`}
            className={`px-3 py-1.5 rounded-full text-sm capitalize ${BADGE[c]} ${cls === c ? "ring-2 ring-ink/20" : ""}`}>{c} · {counts[c] ?? 0}</Link>
        ))}
        <Link href={`/admin/inventory?deadDays=${deadDays}&lowQty=${lowQty}`} className="px-3 py-1.5 rounded-full text-sm bg-white border border-sand text-muted">All · {rows.length}</Link>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left">
            <tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3">Qty</th><th className="p-3">Last movement</th><th className="p-3">Health</th><th className="p-3">Visibility</th><th className="p-3 text-right">Actions</th></tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="p-4 text-muted">No items match.</td></tr>}
            {shown.map((r) => (
              <tr key={r.sku} className="border-t border-sand/60 hover:bg-cream/40 align-middle">
                <td className="p-3 text-ink"><Link href={`/admin/products/${r.id}`} className="hover:text-emerald font-medium" title="Open product management">{r.name}</Link> <span className="text-muted">· {r.sku}</span></td>
                <td className="p-3 text-muted">{r.category}</td>
                <td className="p-3"><span className={r.qty <= lowQty ? "text-rose font-medium" : ""}>{r.qty}</span></td>
                <td className="p-3 text-muted">{daysSince(r.lastMovementAt)}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${BADGE[r.cls]}`}>{r.cls}</span></td>
                <td className="p-3"><span className={`text-xs ${r.status === "published" ? "text-emerald-dark" : "text-gold-dark"}`}>{r.status === "published" ? "Visible" : "Hidden"}</span></td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-1.5 justify-end items-center">
                    <Link href={`/admin/products/${r.id}`} className="px-2.5 py-1 rounded-full bg-ink text-white text-xs hover:bg-ink/90">Manage</Link>
                    <Link href={`/admin/product/${r.sku}`} className="px-2.5 py-1 rounded-full bg-ink/5 text-ink text-xs hover:bg-ink/10">360°</Link>
                    <Link href={`/shop/${r.categorySlug}/${r.sku}`} target="_blank" className="text-xs text-emerald nav-link">view ↗</Link>
                    {can(session, "catalog.publish") && (
                      <form action={setProductVisibilityAction}>
                        <input type="hidden" name="sku" value={r.sku} />
                        <input type="hidden" name="status" value={r.status === "published" ? "draft" : "published"} />
                        <button className="px-2.5 py-1 rounded-full bg-gold/15 text-gold-dark text-xs hover:bg-gold/25">{r.status === "published" ? "Hide" : "Show"}</button>
                      </form>
                    )}
                    {can(session, "catalog.delete") && <DeleteProductButton sku={r.sku} className="px-2.5 py-1 rounded-full bg-rose/10 text-rose text-xs hover:bg-rose/20" label="🗑" />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager basePath="/admin/inventory" params={{ deadDays: String(deadDays), lowQty: String(lowQty), cls, q: searchParams.q }} page={page} pageSize={PAGE_SIZE} total={total} />
    </main>
  );
}
