/**
 * Pure storefront catalogue helpers — category matching, card-safe category refs,
 * and homepage rails. Kept I/O-free so listing logic cannot blank the shop when a
 * join is missing or a slug differs by hyphen/plural, and so it is unit-testable.
 */

export type CategoryRef = { name: string; slug: string };

/** Shown if the category table is briefly unreachable — links still hit real /shop/c/ slugs. */
export const FALLBACK_SHOP_CATEGORIES: CategoryRef[] = [
  { name: "Necklaces", slug: "necklace" },
  { name: "Earrings", slug: "earrings" },
  { name: "Bracelets", slug: "bracelet" },
  { name: "Rings", slug: "ring" },
  { name: "Anklets", slug: "anklet" },
  { name: "Maang Tikka", slug: "maang-tikka" },
];

function asObj(c: unknown): { name?: string; slug?: string } | null {
  if (!c) return null;
  if (Array.isArray(c)) return (c[0] as { name?: string; slug?: string }) ?? null;
  if (typeof c === "object") return c as { name?: string; slug?: string };
  return null;
}

/** Never let a missing/array category join crash ProductCard (`p.category.slug`). */
export function categoryRef(p: { category?: unknown; category_slug?: string } | null | undefined): CategoryRef {
  const obj = asObj(p?.category);
  const slug = (obj?.slug || p?.category_slug || "all").trim() || "all";
  const name = (obj?.name || "Jewellery").trim() || "Jewellery";
  return { name, slug };
}

export function slugifyName(name: string): string {
  return name.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** True when a storefront product belongs on the given category page. */
export function matchesCategorySlug(
  p: { category?: unknown; category_id?: string | null },
  slug: string,
  cat?: { id?: string; name?: string; slug?: string } | null,
): boolean {
  if (!slug || slug === "all") return true;
  const want = slug.trim().toLowerCase();
  const ref = categoryRef(p);
  if (ref.slug.toLowerCase() === want) return true;
  if (cat?.id && p.category_id === cat.id) return true;
  const names = [ref.name, cat?.name].filter(Boolean).map((n) => n!.trim().toLowerCase());
  for (const n of names) {
    if (!n) continue;
    if (slugifyName(n) === want) return true;
    if (slugifyName(n + "s") === want || slugifyName(n.replace(/s$/, "")) === want) return true;
  }
  return false;
}

export function pickNewArrivals<T extends { created_at?: string | null; sku: string }>(products: T[], n = 8): T[] {
  const createdMs = (p: T) => (p.created_at ? new Date(p.created_at).getTime() : 0);
  return [...products].sort((a, b) => createdMs(b) - createdMs(a)).slice(0, n);
}

export function pickBestsellers<T extends { sku: string; reviews?: number; rating?: number }>(
  products: T[],
  excludeSkus: Set<string>,
  n = 8,
): T[] {
  return [...products]
    .sort((a, b) => ((b.reviews ?? 0) - (a.reviews ?? 0)) || ((b.rating ?? 0) - (a.rating ?? 0)) || a.sku.localeCompare(b.sku))
    .filter((p) => !excludeSkus.has(p.sku))
    .slice(0, n);
}

export function publicCategories<T extends { name?: string | null }>(tree: T[]): T[] {
  return tree.filter((c) => c.name?.trim().toLowerCase() !== "uncategorized");
}
