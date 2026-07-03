"use client";
import { useState } from "react";
import Link from "next/link";
import { CatalogueRowActions } from "@/components/admin/CatalogueRowActions";
import { GeneratePhotoButton } from "@/components/admin/GeneratePhotoButton";
import { DeleteProductButton } from "@/components/admin/DeleteProductButton";
import { ProductTags } from "@/components/admin/ProductTags";

type V = { sku: string; color: string | null; qty: number };
export type CatalogueRowProduct = {
  id: string; sku: string; name: string; status: string;
  image: string | null; categoryName: string; categorySlug: string;
  qty: number; priceLabel: string; offerPct: number; hasOffer: boolean;
  hasAi: boolean; variants: V[]; adminTags: string[]; wholesaleLabel: string;
};

/** One catalogue row: a clean summary line (photo · name · category · price) that EXPANDS on click
 *  to reveal everything not needed at first sight — publish, add image, variants & their stock, and
 *  the edit / view / AI / delete actions. Keeps the list scannable. */
export function CatalogueRow({
  p, canEdit, canAi, canDelete, canPublish, genContent,
}: {
  p: CatalogueRowProduct;
  canEdit: boolean; canAi: boolean; canDelete: boolean; canPublish: boolean;
  genContent: (fd: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [showWholesale, setShowWholesale] = useState(false);
  const published = p.status === "published";

  return (
    <>
      <tr className="border-t border-sand/60 hover:bg-cream/40 transition-colors cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <td className="p-2">
          <div className="w-11 h-14 rounded-lg overflow-hidden border border-sand bg-cream">
            {p.image
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={p.image} alt={p.sku} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-center text-[8px] leading-tight text-muted px-0.5">No image</div>}
          </div>
        </td>
        <td className="p-3 font-medium text-ink">
          {p.name}
          {!published && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gold-dark">· {p.status}</span>}
        </td>
        <td className="p-3 text-muted whitespace-nowrap">{p.categoryName} · {p.sku}</td>
        <td className="p-3"><span className="font-semibold">{p.priceLabel}</span>{p.hasOffer && <span className="text-xs text-rose ml-1">{p.offerPct}% off</span>}</td>
        <td className="p-2" onClick={(e) => e.stopPropagation()}>
          <ProductTags sku={p.sku} initial={p.adminTags} canEdit={canEdit} compact stopClick />
        </td>
        <td className="p-3 text-right text-muted">{open ? "▴" : "▾"}</td>
      </tr>

      {open && (
        <tr className="bg-cream/30">
          <td colSpan={6} className="px-4 py-4">
            <div className="flex flex-wrap gap-x-10 gap-y-5">
              {/* Pricing — retail is shown in the row; wholesale is tap-to-reveal (kept private). */}
              <div className="min-w-[150px]">
                <p className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Pricing</p>
                <p className="text-sm text-ink">Retail <span className="font-semibold">{p.priceLabel}</span></p>
                <button
                  type="button"
                  onClick={() => setShowWholesale((s) => !s)}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-sand px-2.5 py-1 text-sm hover:border-emerald"
                  title={showWholesale ? "Hide wholesale price" : "Tap to reveal wholesale price"}
                >
                  <span className="text-muted text-[11px]">Wholesale</span>
                  {showWholesale
                    ? <span className="font-semibold text-emerald-dark">{p.wholesaleLabel}</span>
                    : <span className="font-mono tracking-widest text-muted">••••</span>}
                  <span className="text-[10px] text-muted">{showWholesale ? "🙈" : "👁 tap"}</span>
                </button>
              </div>

              {/* Image & publish */}
              <div>
                <p className="text-[11px] uppercase tracking-wide text-muted mb-1.5">Image &amp; publish</p>
                <CatalogueRowActions sku={p.sku} status={p.status} image={p.image} canEdit={canEdit} canPublish={canPublish} />
              </div>

              {/* Variants & stock */}
              <div className="min-w-[180px]">
                <p className="text-[11px] uppercase tracking-wide text-muted mb-1.5">{p.variants.length > 0 ? "Stock by variant" : "Stock"}</p>
                {p.variants.length === 0 ? (
                  <p className={`text-lg font-semibold ${p.qty <= 2 ? "text-rose" : "text-ink"}`}>{p.qty} pcs</p>
                ) : (
                  <ul className="text-sm space-y-0.5">
                    {p.variants.map((v) => (
                      <li key={v.sku} className="flex items-center justify-between gap-4">
                        <span className="text-ink">{v.color ?? "—"} <span className="font-mono text-[11px] text-muted">{v.sku}</span></span>
                        <span className={`font-medium ${v.qty <= 2 ? "text-rose" : "text-ink"}`}>{v.qty}</span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between gap-4 border-t border-sand/60 pt-1 mt-0.5 font-medium">
                      <span className="text-muted">Total</span><span className="text-ink">{p.qty}</span>
                    </li>
                  </ul>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-start gap-2">
                {canEdit && <Link href={`/admin/catalogue/${p.sku}`} className="px-3 py-1.5 rounded-full bg-ink/5 text-ink text-xs font-medium hover:bg-ink/10">✎ Edit</Link>}
                <Link href={`/admin/product/${p.sku}`} className="px-3 py-1.5 rounded-full bg-ink/5 text-ink text-xs hover:bg-ink/10">360°</Link>
                <Link href={`/shop/${p.categorySlug}/${p.sku}`} target="_blank" className="px-3 py-1.5 rounded-full bg-emerald-mist text-emerald-dark text-xs hover:bg-emerald-mist/70">View ↗</Link>
                {canAi && (
                  <form action={genContent}>
                    <input type="hidden" name="sku" value={p.sku} />
                    <button className="px-3 py-1.5 rounded-full bg-emerald/10 text-emerald text-xs font-medium hover:bg-emerald/20">{p.hasAi ? "Regenerate AI page" : "Generate AI page"}</button>
                  </form>
                )}
                {canAi && <GeneratePhotoButton sku={p.sku} />}
                {canDelete && <DeleteProductButton sku={p.sku} className="px-3 py-1.5 rounded-full bg-rose/10 text-rose text-xs hover:bg-rose/20" label="🗑 Delete" />}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
