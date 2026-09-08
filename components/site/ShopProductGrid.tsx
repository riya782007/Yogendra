"use client";
import { useState } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/site/ProductCard";
import { Reveal } from "@/components/site/Reveal";
import { Back } from "@/components/site/Back";
import { categoryRef } from "@/lib/shopCatalog";
import type { PricingFormula } from "@/lib/pricing";

const PAGE = 48;

export function ShopProductGrid({
  title,
  subtitle,
  products,
  formula,
}: {
  title: string;
  subtitle?: string;
  products: any[];
  formula: PricingFormula;
}) {
  const [shown, setShown] = useState(PAGE);
  const visible = products.slice(0, shown);
  return (
    <div className="max-w-7xl mx-auto px-5 py-8">
      <div className="flex items-center justify-between gap-4 mb-2">
        <Back label="Back" />
        <div className="text-xs text-muted"><Link href="/shop" className="hover:text-emerald">Home</Link> / <span className="text-ink">{title}</span></div>
      </div>
      <header className="text-center my-8">
        <p className="text-gold-dark tracking-[0.25em] uppercase text-xs">Collection</p>
        <h1 className="font-display text-5xl text-ink mt-1">{title}</h1>
        <p className="text-muted mt-2">{subtitle ?? `${products.length} designs · live pricing & stock`}</p>
      </header>
      {products.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-ink font-medium">Designs are refreshing — please try again in a moment.</p>
          <p className="text-muted text-sm mt-1">Browse by <Link href="/shop" className="text-emerald nav-link">category</Link> or open the <Link href="/shop/all" className="text-emerald nav-link">full collection</Link>.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {visible.map((p, i) => (
              <Reveal key={p.sku} delay={(i % 4) * 70}>
                <ProductCard p={{ ...(p as any), category: categoryRef(p) }} formula={formula} index={i} />
              </Reveal>
            ))}
          </div>
          {shown < products.length && (
            <div className="text-center mt-8">
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="px-6 py-2.5 rounded-full border border-emerald text-emerald text-sm font-medium hover:bg-emerald-mist">
                Load more — showing {shown} of {products.length}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
