import { NextResponse } from "next/server";
import { getCatalogSuggestionsCached } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

/**
 * Lightweight typeahead for the retail /search page.
 * Returns matching categories, products, and colours so typing "neck"
 * surfaces Necklaces in a dropdown (owner request).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  if (!q || q.length < 1) {
    return NextResponse.json({ hits: [] }, { headers: { "Cache-Control": "public, s-maxage=60" } });
  }
  try {
    const s = await getCatalogSuggestionsCached();
    const hits: { kind: string; label: string; href: string }[] = [];
    for (const c of s.categories) {
      if (c.name.toLowerCase().includes(q)) {
        hits.push({ kind: "category", label: c.name, href: `/shop/${c.slug}` });
      }
      if (hits.length >= 6) break;
    }
    for (const p of s.products) {
      if (p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)) {
        hits.push({ kind: "product", label: p.name, href: `/search?q=${encodeURIComponent(p.name)}` });
      }
      if (hits.length >= 12) break;
    }
    for (const col of s.colours) {
      if (col.toLowerCase().includes(q)) {
        hits.push({ kind: "colour", label: col, href: `/search?q=${encodeURIComponent(col)}` });
      }
      if (hits.length >= 14) break;
    }
    hits.push({ kind: "search", label: `Search “${q}”`, href: `/search?q=${encodeURIComponent(q)}` });
    return NextResponse.json(
      { hits: hits.slice(0, 14) },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch {
    return NextResponse.json({ hits: [] });
  }
}
