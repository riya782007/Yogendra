"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { updateProductAction } from "@/app/actions/updateProduct";

type Cat = { id: string; name: string; slug: string };
export type EditorProduct = {
  sku: string;
  name: string;
  categoryId: string;
  categorySlug: string;
  type: string;
  status: string;
  basePriceRupees: number;
  qty: number;
  title: string;
  description: string;
  tags: string;        // newline-joined
  metaTitle: string;
  metaDescription: string;
  keywords: string;    // newline-joined
  specs: string;       // "Key: Value" lines
};

const label = "block text-xs font-medium text-muted mb-1.5";
const field =
  "w-full rounded-xl border border-sand bg-white px-3.5 py-2.5 text-sm text-ink focus:border-emerald focus:ring-2 focus:ring-emerald/20 outline-none transition";

export function ProductEditor({
  product,
  categories,
  formula,
}: {
  product: EditorProduct;
  categories: Cat[];
  formula: { retailMultiplier: number; mrpMultiplier: number; wholesaleMarkupPct: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [base, setBase] = useState(product.basePriceRupees);
  const [saving, setSaving] = useState(false);

  const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
  const retail = base * formula.retailMultiplier;
  const mrp = base * formula.mrpMultiplier;
  const wholesale = base * (1 + formula.wholesaleMarkupPct / 100);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const res = await updateProductAction(fd);
    setSaving(false);
    if (res.ok) {
      toast("Product saved ✓");
      router.refresh();
    } else {
      toast(res.error ?? "Could not save", "error");
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6 max-w-3xl">
      <input type="hidden" name="sku" value={product.sku} />

      {/* CORE DETAILS */}
      <section className="rounded-2xl border border-sand bg-white p-5 shadow-card">
        <h2 className="font-display text-xl text-ink mb-4">Core details</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label}>Product name</label>
            <input name="name" defaultValue={product.name} className={field} required />
          </div>
          <div>
            <label className={label}>SKU <span className="text-muted/70">(editable — must be unique &amp; is scannable)</span></label>
            <input name="new_sku" defaultValue={product.sku} className={`${field} uppercase`} pattern="[A-Za-z0-9\-]+" title="Letters, numbers and hyphens only" />
          </div>
          <div>
            <label className={label}>Category</label>
            <select name="category_id" defaultValue={product.categoryId} className={field}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Type</label>
            <select name="type" defaultValue={product.type} className={field}>
              <option value="simple">Simple</option>
              <option value="configurable">Configurable (colours)</option>
            </select>
          </div>
          <div>
            <label className={label}>Status</label>
            <select name="status" defaultValue={product.status} className={field}>
              <option value="published">Published (visible on shop)</option>
              <option value="draft">Draft (hidden)</option>
              <option value="flagged">Flagged</option>
            </select>
          </div>
          <div>
            <label className={label}>Base wholesale cost (₹)</label>
            <input
              name="base_price_rupees"
              type="number"
              min={1}
              step="1"
              value={base}
              onChange={(e) => setBase(Number(e.target.value))}
              className={field}
              required
            />
          </div>
          <div>
            <label className={label}>Stock quantity</label>
            <input name="qty" type="number" min={0} step="1" defaultValue={product.qty} className={field} />
          </div>
        </div>

        {/* live price preview */}
        <div className="mt-4 rounded-xl bg-cream/60 px-4 py-3 text-sm flex flex-wrap gap-x-6 gap-y-1">
          <span className="text-muted">From your pricing formula:</span>
          <span>Retail <b className="text-ink">{inr(retail)}</b></span>
          <span>MRP <b className="text-ink">{inr(mrp)}</b></span>
          <span>Wholesale rate <b className="text-ink">{inr(wholesale)}</b></span>
        </div>
      </section>

      {/* STOREFRONT CONTENT */}
      <section className="rounded-2xl border border-sand bg-white p-5 shadow-card">
        <h2 className="font-display text-xl text-ink mb-1">Storefront content</h2>
        <p className="text-xs text-muted mb-4">What the customer reads on the product page.</p>
        <div className="space-y-4">
          <div>
            <label className={label}>Display title</label>
            <input name="title" defaultValue={product.title} className={field} />
          </div>
          <div>
            <label className={label}>Description</label>
            <textarea name="description" defaultValue={product.description} rows={6} className={field} />
          </div>
          <div>
            <label className={label}>Tags <span className="text-muted/70">(one per line or comma-separated — shown as chips & used for filtering)</span></label>
            <textarea name="tags" defaultValue={product.tags} rows={4} className={field} placeholder={"Necklace\nKundan\nwedding"} />
          </div>
          <div>
            <label className={label}>Specifications <span className="text-muted/70">(one per line, format “Key: Value”)</span></label>
            <textarea name="specs" defaultValue={product.specs} rows={6} className={`${field} font-mono text-[13px]`} placeholder={"Material: Brass alloy\nPlating: Anti-tarnish gold-tone\nOccasion: Wedding, festive"} />
          </div>
        </div>
      </section>

      {/* SEO */}
      <section className="rounded-2xl border border-sand bg-white p-5 shadow-card">
        <h2 className="font-display text-xl text-ink mb-1">SEO &amp; Google</h2>
        <p className="text-xs text-muted mb-4">How this page appears in Google search and gets found.</p>
        <div className="space-y-4">
          <div>
            <label className={label}>Meta title <span className="text-muted/70">(~60 chars)</span></label>
            <input name="meta_title" defaultValue={product.metaTitle} maxLength={70} className={field} />
          </div>
          <div>
            <label className={label}>Meta description <span className="text-muted/70">(~155 chars)</span></label>
            <textarea name="meta_description" defaultValue={product.metaDescription} rows={3} maxLength={180} className={field} />
          </div>
          <div>
            <label className={label}>Keywords <span className="text-muted/70">(one per line or comma-separated)</span></label>
            <textarea name="keywords" defaultValue={product.keywords} rows={4} className={field} placeholder={"Kundan necklace\nartificial jewellery Delhi\nnecklace for wedding"} />
          </div>
        </div>
      </section>

      {/* ACTIONS */}
      <div className="flex items-center gap-3 sticky bottom-0 bg-cream/80 backdrop-blur py-3">
        <button type="submit" disabled={saving} className="btn-primary px-6 py-2.5 text-sm font-medium disabled:opacity-60">
          {saving ? "Saving…" : "Save changes"}
        </button>
        <Link href={`/shop/${product.categorySlug}/${product.sku}`} target="_blank" className="text-sm text-emerald nav-link">
          View live page ↗
        </Link>
        <Link href="/admin/catalogue" className="text-sm text-muted hover:text-ink ml-auto">← Back to catalogue</Link>
      </div>
    </form>
  );
}
