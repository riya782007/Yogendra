import Link from "next/link";

/**
 * Server-side pager. Builds page links that preserve existing query params.
 * `params` is the current searchParams object; `page` is 1-based.
 */
export function Pager({
  basePath, params, page, pageSize, total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    sp.set("page", String(p));
    return `${basePath}?${sp.toString()}`;
  };

  // compact window of page numbers
  const win: number[] = [];
  const start = Math.max(1, page - 2), end = Math.min(pages, page + 2);
  for (let i = start; i <= end; i++) win.push(i);

  const btn = "min-w-[2rem] h-8 px-2 inline-flex items-center justify-center rounded-lg text-sm border transition-colors";
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-4">
      <span className="text-xs text-muted mr-2">{from}–{to} of {total}</span>
      <Link href={href(Math.max(1, page - 1))} aria-disabled={page === 1}
        className={`${btn} ${page === 1 ? "border-sand text-muted/40 pointer-events-none" : "border-sand text-ink hover:border-gold"}`}>‹</Link>
      {start > 1 && <><Link href={href(1)} className={`${btn} border-sand text-ink hover:border-gold`}>1</Link>{start > 2 && <span className="text-muted px-1">…</span>}</>}
      {win.map((p) => (
        <Link key={p} href={href(p)} className={`${btn} ${p === page ? "border-ink bg-ink text-white" : "border-sand text-ink hover:border-gold"}`}>{p}</Link>
      ))}
      {end < pages && <>{end < pages - 1 && <span className="text-muted px-1">…</span>}<Link href={href(pages)} className={`${btn} border-sand text-ink hover:border-gold`}>{pages}</Link></>}
      <Link href={href(Math.min(pages, page + 1))} aria-disabled={page === pages}
        className={`${btn} ${page === pages ? "border-sand text-muted/40 pointer-events-none" : "border-sand text-ink hover:border-gold"}`}>›</Link>

      {/* Jump straight to any page — type a number and press Go/Enter */}
      <form action={basePath} className="flex items-center gap-1 ml-2">
        {Object.entries(params).map(([k, v]) => (v && k !== "page" ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        <span className="text-xs text-muted">Go to</span>
        <input name="page" type="number" min={1} max={pages} defaultValue={page} inputMode="numeric"
          aria-label="Page number"
          className="w-16 h-8 rounded-lg border border-sand px-2 text-sm text-ink bg-white outline-none focus:border-gold" />
        <button className={`${btn} border-sand text-ink hover:border-gold`}>Go</button>
        <span className="text-xs text-muted">/ {pages}</span>
      </form>
    </div>
  );
}
