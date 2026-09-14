import { describe, it, expect } from "vitest";
import {
  categoryRef,
  matchesCategorySlug,
  pickBestsellers,
  pickNewArrivals,
  publicCategories,
  slugifyName,
} from "../lib/shopCatalog";

describe("shopCatalog category matching", () => {
  it("never crashes on missing or array category joins", () => {
    expect(categoryRef({}).slug).toBe("all");
    expect(categoryRef({ category: [{ name: "Earrings", slug: "earrings" }] }).slug).toBe("earrings");
    expect(categoryRef({ category: { name: "Necklaces", slug: "necklace" } }).name).toBe("Necklaces");
  });

  it("matches by slug, category_id, and plural/hyphen names", () => {
    const p = { category: { name: "Bracelets", slug: "bracelet" }, category_id: "cat-1" };
    expect(matchesCategorySlug(p, "bracelet")).toBe(true);
    expect(matchesCategorySlug(p, "bracelets")).toBe(true);
    expect(matchesCategorySlug(p, "necklace")).toBe(false);
    expect(matchesCategorySlug(p, "all")).toBe(true);
    expect(matchesCategorySlug({ category: null, category_id: "cat-1" }, "bracelet", { id: "cat-1", name: "Bracelet", slug: "bracelet" })).toBe(true);
  });

  it("slugifyName is stable", () => {
    expect(slugifyName("Maang Tikka")).toBe("maang-tikka");
  });

  it("hides Uncategorized from shoppers", () => {
    expect(publicCategories([{ name: "Necklaces" }, { name: "Uncategorized" }]).map((c) => c.name)).toEqual(["Necklaces"]);
  });

  it("new arrivals and bestsellers stay disjoint", () => {
    const products = [
      { sku: "A", created_at: "2026-09-01", reviews: 1, rating: 4 },
      { sku: "B", created_at: "2026-08-01", reviews: 50, rating: 5 },
      { sku: "C", created_at: "2026-07-01", reviews: 20, rating: 5 },
    ];
    const neu = pickNewArrivals(products, 1);
    expect(neu[0].sku).toBe("A");
    const best = pickBestsellers(products, new Set(neu.map((p) => p.sku)), 2);
    expect(best.map((p) => p.sku)).not.toContain("A");
    expect(best[0].sku).toBe("B");
  });
});
