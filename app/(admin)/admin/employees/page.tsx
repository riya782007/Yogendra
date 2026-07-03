export const dynamic = "force-dynamic";
import Link from "next/link";
import { getEmployees, getEmployeePerformance } from "@/lib/supabase/queries";
import { formatPaise } from "@/lib/pricing";
import { getSession, can } from "@/lib/auth";
import { upsertEmployeeAction, setEmployeeActiveAction } from "@/app/actions/employees";

export const metadata = { title: "Owner Console · Employees" };

const card = "bg-white rounded-2xl border border-sand p-5 shadow-card";
const inp = "rounded-xl border border-sand px-3 py-2 text-sm bg-white outline-none focus:border-emerald";

/** Resolve the ?period= filter to an ISO date range (or none = all time). */
function rangeFor(period: string): { from?: string; to?: string; label: string } {
  const now = new Date();
  if (period === "all") return { label: "All time" };
  if (period === "30d") return { from: new Date(now.getTime() - 30 * 86400000).toISOString(), label: "Last 30 days" };
  // default: this calendar month
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  return { from, label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
}

export default async function EmployeesPage({ searchParams }: { searchParams: { period?: string } }) {
  const canManage = can(getSession(), "customers.manage");
  const period = searchParams.period ?? "month";
  const range = rangeFor(period);
  const [roster, perf] = await Promise.all([getEmployees({}), getEmployeePerformance(range)]);

  const totalSales = perf.reduce((s, p) => s + p.sales, 0);
  const tab = (key: string, label: string) =>
    `px-3.5 py-1.5 rounded-full text-sm ${period === key ? "bg-ink text-white" : "bg-white border border-sand text-muted hover:border-emerald"}`;

  return (
    <main className="p-4 sm:p-8 bg-cream/40 min-h-screen">
      <h1 className="font-display text-4xl text-ink mb-1">Employees</h1>
      <p className="text-sm text-muted mb-5">Your team, and how much each has sold. Attribution is captured at billing — pick the salesperson on the POS customer panel — so you can reward performance.</p>

      {/* Add employee */}
      {canManage && (
        <form action={upsertEmployeeAction} className={`${card} mb-6 flex flex-wrap items-end gap-3`}>
          <label className="text-[11px] text-muted">Name<input name="name" required placeholder="Full name" className={`${inp} block mt-0.5 w-48`} /></label>
          <label className="text-[11px] text-muted">Phone<input name="phone" placeholder="Optional" className={`${inp} block mt-0.5 w-40`} /></label>
          <label className="text-[11px] text-muted">Role / title<input name="title" placeholder="e.g. Counter sales" className={`${inp} block mt-0.5 w-44`} /></label>
          <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Add employee</button>
        </form>
      )}

      {/* Period filter */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-[11px] uppercase tracking-wide text-muted mr-1">Sales in</span>
        <Link href="/admin/employees?period=month" className={tab("month", "This month")}>This month</Link>
        <Link href="/admin/employees?period=30d" className={tab("30d", "Last 30 days")}>Last 30 days</Link>
        <Link href="/admin/employees?period=all" className={tab("all", "All time")}>All time</Link>
        <span className="ml-auto text-sm text-muted">Team total <b className="text-ink">{formatPaise(totalSales)}</b> · {range.label}</span>
      </div>

      {/* Performance table */}
      <div className="bg-white rounded-2xl shadow-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-cream text-muted text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2.5">#</th>
              <th className="px-4 py-2.5">Employee</th>
              <th className="px-4 py-2.5 text-right">Bills</th>
              <th className="px-4 py-2.5 text-right">Sales</th>
              <th className="px-4 py-2.5 text-right">Collected</th>
              <th className="px-4 py-2.5 text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sand/60">
            {perf.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">No employees yet — add your first above.</td></tr>
            )}
            {perf.map((e, i) => {
              const roster1 = roster.find((r) => r.id === e.id);
              return (
                <tr key={e.id} className={e.active ? "" : "opacity-60"}>
                  <td className="px-4 py-2.5 text-muted">{i + 1}</td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink">{e.name}</span>
                    {roster1?.title && <span className="ml-2 text-xs text-muted">{roster1.title}</span>}
                    {roster1?.phone && <span className="block text-[11px] text-muted">{roster1.phone}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{e.orders}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-ink">{formatPaise(e.sales)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-dark">{formatPaise(e.collected)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage ? (
                      <form action={setEmployeeActiveAction} className="inline">
                        <input type="hidden" name="id" value={e.id} />
                        <input type="hidden" name="active" value={(!e.active).toString()} />
                        <button className={`text-xs px-2.5 py-1 rounded-full ${e.active ? "bg-emerald-mist text-emerald-dark" : "bg-sand/60 text-muted"}`}>
                          {e.active ? "Active" : "Inactive"}
                        </button>
                      </form>
                    ) : (
                      <span className={`text-xs px-2.5 py-1 rounded-full ${e.active ? "bg-emerald-mist text-emerald-dark" : "bg-sand/60 text-muted"}`}>{e.active ? "Active" : "Inactive"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted mt-3">Sales = total value of bills attributed to the employee in the selected period. Collected = amount actually received on those bills. Marking someone inactive hides them from the POS picker but keeps their past sales.</p>
    </main>
  );
}
