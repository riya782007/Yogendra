export const dynamic = "force-dynamic";
import Link from "next/link";
import { getSuppliersList, getSupplierCities } from "@/lib/supabase/queries";
import { upsertSupplierAction, deleteSupplierAction } from "@/app/actions/suppliers";
import { Pager } from "@/components/admin/Pager";

export const metadata = { title: "Owner Console · Suppliers & Vendors" };
const PAGE_SIZE = 25;

const KIND_STYLE: Record<string, string> = { supplier: "bg-emerald-mist text-emerald-dark", vendor: "bg-gold/15 text-gold-dark" };

export default async function Suppliers({ searchParams }: { searchParams: { q?: string; kind?: string; city?: string; page?: string } }) {
  const q = searchParams.q ?? "";
  const kind = searchParams.kind ?? "all";
  const city = searchParams.city ?? "all";
  const page = Math.max(1, parseInt(searchParams.page ?? "1", 10) || 1);
  const [all, cities] = await Promise.all([getSuppliersList({ q, kind, city }), getSupplierCities()]);
  const rows = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const sel = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald";
  const fld = "rounded-xl border border-sand bg-white px-3 py-2 text-sm outline-none focus:border-emerald w-full";

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen max-w-5xl">
      <h1 className="font-display text-4xl text-ink mb-1">Suppliers &amp; Vendors</h1>
      <p className="text-sm text-muted mb-5">Your sourcing book — organised by location, searchable, with GST details for purchase bills.</p>

      {/* Add form */}
      <form action={upsertSupplierAction} className="bg-white rounded-2xl p-5 shadow-card mb-5 border border-sand">
        <h2 className="font-medium text-ink mb-3">Add supplier / vendor</h2>
        <div className="grid sm:grid-cols-3 gap-3">
          <input name="name" placeholder="Name / firm *" className={fld} required />
          <select name="kind" className={fld} defaultValue="supplier"><option value="supplier">Supplier</option><option value="vendor">Vendor</option></select>
          <input name="phone" placeholder="Phone" className={fld} />
          <input name="city" placeholder="City" className={fld} />
          <input name="state" placeholder="State" className={fld} />
          <input name="gstin" placeholder="GSTIN" className={fld} />
          <input name="address" placeholder="Address" className={`${fld} sm:col-span-2`} />
          <input name="notes" placeholder="Notes (e.g. specialises in kundan)" className={fld} />
        </div>
        <button className="btn-primary px-5 py-2.5 text-sm font-medium mt-3">Save</button>
      </form>

      {/* Filters */}
      <form action="/admin/suppliers" className="flex flex-wrap gap-2 mb-4">
        <input name="q" defaultValue={q} placeholder="Search name / phone / GSTIN…" className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[160px]" />
        <select name="kind" defaultValue={kind} className={sel}><option value="all">All types</option><option value="supplier">Suppliers</option><option value="vendor">Vendors</option></select>
        <select name="city" defaultValue={city} className={sel}><option value="all">All cities</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Filter</button>
        {(q || kind !== "all" || city !== "all") && <Link href="/admin/suppliers" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>

      <div className="overflow-x-auto rounded-2xl border border-sand bg-white shadow-card">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left"><tr>
            <th className="p-3">Name</th><th className="p-3">Type</th><th className="p-3">Location</th><th className="p-3">Phone</th><th className="p-3">GSTIN</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-4 text-muted">No suppliers match.</td></tr>}
            {rows.map((s: any) => (
              <tr key={s.id} className="border-t border-sand/60 align-top">
                <td className="p-3 font-medium"><Link href={`/admin/supplier/${s.id}`} className="text-emerald nav-link">{s.name} ↗</Link>{s.notes && <span className="block text-xs text-muted font-normal">{s.notes}</span>}</td>
                <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs capitalize ${KIND_STYLE[s.kind] ?? "bg-cream text-muted"}`}>{s.kind}</span></td>
                <td className="p-3 text-muted">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                <td className="p-3 text-muted">{s.phone || "—"}</td>
                <td className="p-3 text-muted text-xs">{s.gstin || "—"}</td>
                <td className="p-3 text-right"><form action={deleteSupplierAction}><input type="hidden" name="id" value={s.id} /><button className="text-muted hover:text-rose text-xs">Delete</button></form></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager basePath="/admin/suppliers" params={{ q, kind, city }} page={page} pageSize={PAGE_SIZE} total={all.length} />
      <p className="text-xs text-muted mt-2">{all.length} record{all.length === 1 ? "" : "s"}</p>
    </main>
  );
}
