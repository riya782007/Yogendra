export const dynamic = "force-dynamic";
import Link from "next/link";
import { getAbandonedCarts, searchShopperContacts } from "@/lib/supabase/queries";
import { supabaseServer } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/pricing";
import { AbandonedCartCard } from "@/components/admin/AbandonedCartCard";
import { ClearAnonCartsButton } from "@/components/admin/ClearAnonCartsButton";
import { AbandonedCartsPdfButton } from "@/components/admin/AbandonedCartsPdfButton";
import { BulkWhatsAppButton } from "@/components/admin/BulkWhatsAppButton";
import { phonesAreSameShopper } from "@/lib/phone";

export const metadata = { title: "Owner Console · Abandoned Carts" };

export default async function Abandoned({ searchParams }: { searchParams: { q?: string } }) {
  const q = (searchParams.q ?? "").trim();
  const [carts, extra] = await Promise.all([
    getAbandonedCarts({ search: q || undefined }),
    q ? searchShopperContacts(q) : Promise.resolve({ visitors: [] as any[], customers: [] as any[], orders: [] as any[] }),
  ]);
  const recoverable = carts.filter((c: any) => !c.recovered).reduce((s: number, c: any) => s + (c.total ?? 0), 0);
  const cartPhones = carts.map((c: any) => c.phone);
  const visitors = extra.visitors.filter((v: any) => !cartPhones.some((p) => phonesAreSameShopper(p, v.phone)));
  const customers = extra.customers.filter((c: any) => !cartPhones.some((p) => phonesAreSameShopper(p, c.phone)));
  const orders = extra.orders.slice(0, 8);

  // #21: first image + category slug per SKU — powers the thumbnails and the "View product" links.
  const allSkus = Array.from(new Set(
    carts.flatMap((c: any) => ((c.items ?? []) as any[]).map((i) => i.sku).filter(Boolean)),
  ));
  const imgMap: Record<string, string> = {};
  const slugMap: Record<string, string> = {};
  if (allSkus.length) {
    const sbA = supabaseServer();
    // Cart items can be PRODUCT skus OR VARIANT skus (e.g. JBKN5775-RUBY). Resolve both, and match
    // case-insensitively (carts may store GOLD / Gold / gold). Keyed by upper(sku).
    const imgByUpper = new Map<string, string>();
    const slugByUpper = new Map<string, string>();
    const firstHttp = (arr: any[]) => (arr ?? []).filter((i) => typeof i?.path === "string" && i.path.startsWith("http")).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))[0]?.path as string | undefined;
    const chunk = <T,>(a: T[], n: number) => a.reduce<T[][]>((acc, x, i) => { (acc[Math.floor(i / n)] ??= []).push(x); return acc; }, []);
    // Products (match by SKU, case-insensitive). Retail carts store the PRODUCT sku (e.g. WT1043), but a
    // design's photo often lives ONLY on its colour variant (WT1043-GOLD) or on thumbnail_path — not in
    // product_images. So resolve the cover the SAME way the storefront does: thumbnail → product image →
    // any variant photo. Without the variant fallback these cards showed no image at all.
    const firstVarHttp = (vs: any[]) => (vs ?? []).flatMap((v) => (v?.image_paths as string[]) ?? []).find((u) => typeof u === "string" && u.startsWith("http")) as string | undefined;
    for (const grp of chunk(allSkus, 60)) {
      const { data } = await sbA.from("products").select("sku, thumbnail_path, category:categories(slug), images:product_images(path,sort), variants:variants(image_paths)").or(grp.map((s) => `sku.ilike.${String(s).replace(/[,()]/g, "")}`).join(","));
      for (const p of (data as any[]) ?? []) {
        const tp = (typeof p.thumbnail_path === "string" && p.thumbnail_path.startsWith("http")) ? p.thumbnail_path as string : undefined;
        const img = tp ?? firstHttp(p.images) ?? firstVarHttp(p.variants);
        const k = String(p.sku).toUpperCase();
        if (img) imgByUpper.set(k, img);
        if (p.category?.slug) slugByUpper.set(k, p.category.slug);
      }
    }
    // Variants → the colour's own photo, else the parent product's photo.
    for (const grp of chunk(allSkus, 60)) {
      const { data } = await sbA.from("variants").select("sku, image_paths, product:products(category:categories(slug), images:product_images(path,sort))").or(grp.map((s) => `sku.ilike.${String(s).replace(/[,()]/g, "")}`).join(","));
      for (const v of (data as any[]) ?? []) {
        const k = String(v.sku).toUpperCase();
        const vimg = ((v.image_paths as string[]) ?? []).find((u) => typeof u === "string" && u.startsWith("http"));
        const img = vimg ?? firstHttp(v.product?.images);
        if (img && !imgByUpper.has(k)) imgByUpper.set(k, img);
        if (v.product?.category?.slug && !slugByUpper.has(k)) slugByUpper.set(k, v.product.category.slug);
      }
    }
    for (const s of allSkus) {
      const u = String(s).toUpperCase();
      if (imgByUpper.has(u)) imgMap[s] = imgByUpper.get(u)!;
      if (slugByUpper.has(u)) slugMap[s] = slugByUpper.get(u)!;
    }
  }
  return (
    <main className="p-8 bg-cream/40 min-h-screen max-w-4xl">
      <h1 className="font-display text-4xl text-ink mb-1">Abandoned Carts</h1>
      <p className="text-sm text-muted mb-3">Shoppers who added to bag but didn&apos;t buy. <span className="text-emerald font-medium">{formatPaise(recoverable)}</span> recoverable — nudge them on WhatsApp. Search by <b>last 4 digits</b> of any visitor or customer phone (US, India, anywhere) to pull up a live cart and take the order. Tap a cart to see full product &amp; customer detail. Use <b>✕</b> on any card to remove an irrelevant one.</p>
      <form action="/admin/abandoned" className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q}
          placeholder="Last 4 of phone, full number, or name…"
          className="rounded-xl border border-sand bg-white px-4 py-2 text-sm outline-none focus:border-emerald flex-1 min-w-[220px]" />
        <button className="px-4 py-2 rounded-xl bg-ink text-white text-sm">Find cart</button>
        {q && <Link href="/admin/abandoned" className="px-3 py-2 text-sm text-muted hover:text-ink">Clear</Link>}
      </form>
      {q && (
        <p className="text-xs text-muted mb-3">
          {carts.length} cart{carts.length === 1 ? "" : "s"} matching <span className="font-mono text-ink">“{q}”</span>
          {visitors.length + customers.length + orders.length > 0 ? ` · also ${visitors.length} visitor${visitors.length === 1 ? "" : "s"}, ${customers.length} customer${customers.length === 1 ? "" : "s"}, ${orders.length} recent bill${orders.length === 1 ? "" : "s"}` : ""}
        </p>
      )}
      <div className="mb-5 flex flex-wrap items-center gap-3">{carts.length > 0 && <BulkWhatsAppButton carts={carts.filter((c: any) => !c.recovered) as any} />}<ClearAnonCartsButton />{carts.length > 0 && <AbandonedCartsPdfButton carts={carts as any} imgMap={imgMap} />}</div>

      <div className="space-y-3">
        {carts.length === 0 && <p className="text-sm text-muted">{q ? "No cart for those last digits — check visitors / customers below, or they haven't added to bag yet." : "No abandoned carts."}</p>}
        {carts.map((c: any) => (
          <AbandonedCartCard key={c.id} cart={c} imgMap={imgMap} slugMap={slugMap} />
        ))}
      </div>

      {q && (visitors.length > 0 || customers.length > 0 || orders.length > 0) && (
        <div className="mt-8 space-y-4">
          {visitors.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Matching trade visitors (no open cart)</h2>
              <div className="space-y-2">
                {visitors.map((v: any) => (
                  <div key={v.id} className="bg-white rounded-2xl p-4 shadow-card flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{v.name || "Unnamed"}</p>
                      <p className="text-xs text-muted">{v.phone}{v.city ? ` · ${v.city}` : ""}</p>
                    </div>
                    <Link href={`/admin/billing?phone=${encodeURIComponent(v.phone || "")}&name=${encodeURIComponent(v.name || "")}`}
                      className="text-xs px-3 py-1.5 rounded-full border border-emerald text-emerald-dark">Bill in POS</Link>
                  </div>
                ))}
              </div>
            </section>
          )}
          {customers.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Matching directory customers</h2>
              <div className="space-y-2">
                {customers.map((c: any) => (
                  <div key={c.id} className="bg-white rounded-2xl p-4 shadow-card flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-ink">{c.name} <span className="text-[10px] text-muted uppercase">{c.type}</span></p>
                      <p className="text-xs text-muted">{c.phone}</p>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/admin/customer/${c.id}`} className="text-xs px-3 py-1.5 rounded-full border border-sand">Profile</Link>
                      <Link href={`/admin/billing?phone=${encodeURIComponent(c.phone || "")}&name=${encodeURIComponent(c.name || "")}`}
                        className="text-xs px-3 py-1.5 rounded-full border border-emerald text-emerald-dark">Bill in POS</Link>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {orders.length > 0 && (
            <section>
              <h2 className="text-xs uppercase tracking-wide text-muted mb-2">Recent bills on this number</h2>
              <div className="space-y-2">
                {orders.map((o: any) => (
                  <Link key={o.id} href={`/admin/invoice/${o.id}`} className="block bg-white rounded-2xl p-4 shadow-card hover:border-emerald border border-transparent">
                    <p className="text-sm text-ink">{o.customer_name || "—"} · {o.invoice_no || o.id.slice(0, 8)} · {formatPaise(o.total ?? 0)}</p>
                    <p className="text-xs text-muted">{o.customer_phone} · {o.channel} · {o.status}</p>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
