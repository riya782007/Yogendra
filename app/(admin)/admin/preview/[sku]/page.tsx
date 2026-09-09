/**
 * Staff preview of a storefront product page.
 *
 * The public page at /shop/<category>/<sku> deliberately 404s anything a customer must not see —
 * an unpublished draft, or a design with every colour out of stock. That is right for shoppers,
 * but it meant the owner's "View ↗" button in the catalogue 404'd on exactly the two kinds of
 * product he most needs to look at: the one he has not published yet, and the one that just sold
 * out. There was no way to see the page at all.
 *
 * This route renders the SAME product page with the visibility gate lifted, behind the staff
 * session. It lives under /admin so the middleware keeps it on the admin host and the console's
 * own auth applies; `preview` is passed in code, never from the URL, so nothing a customer can
 * type reaches it.
 */
export const dynamic = "force-dynamic";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getSession, can } from "@/lib/auth";
import { getProductBySku } from "@/lib/supabase/queries";
import { storeUrl } from "@/lib/siteUrl";
import ProductPage from "@/app/(retail)/shop/[category]/[sku]/page";

export const metadata = { title: "Owner Console · Preview" };

export default async function AdminProductPreview({ params }: { params: { sku: string } }) {
  // Same gate as the catalogue itself: if you may not view the catalogue, this is a 404 to you.
  const session = getSession();
  if (!session.authed || !can(session, "catalog.view")) notFound();

  const sku = decodeURIComponent(params.sku ?? "").trim();
  if (!sku) notFound();
  // The category is only used for breadcrumbs on the page; "all" is the documented fallback for a
  // product whose category relation is missing.
  const p = await getProductBySku(sku).catch(() => null);
  const category = p?.category?.slug ?? "all";

  return (
    <main className="bg-cream/40 min-h-screen">
      <div className="max-w-6xl mx-auto px-5 pt-4 flex flex-wrap items-center justify-between gap-3 no-print">
        <Link href="/admin/catalogue" className="text-xs px-3 py-1.5 rounded-full border border-sand bg-white hover:border-emerald">
          ← Back to catalogue
        </Link>
        <div className="flex items-center gap-2">
          <Link href={`/admin/catalogue/${encodeURIComponent(sku)}`} className="text-xs px-3 py-1.5 rounded-full bg-ink/5 text-ink hover:bg-ink/10">
            Edit this design
          </Link>
          <a
            href={storeUrl(`/shop/${category}/${encodeURIComponent(sku)}`)}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-3 py-1.5 rounded-full bg-emerald-mist text-emerald-dark hover:bg-emerald-mist/70"
            title="The real customer URL — only works once the design is published and in stock"
          >
            Open public page ↗
          </a>
        </div>
      </div>

      {/* ProductPage's declared props are params-only (Next.js requires that of a page), so the
          preview flag is handed over through this cast. The page reads it at runtime. */}
      {await (ProductPage as unknown as (p: { params: { category: string; sku: string }; preview: true }) => Promise<JSX.Element>)({
        params: { category, sku },
        preview: true,
      })}
    </main>
  );
}
