import { describe, it, expect } from "vitest";
import { matchesQuery, queryTokens, rankSearch, type SearchableProduct } from "../lib/search";

const P = (over: Partial<SearchableProduct> & { name: string }): SearchableProduct => ({
  sku: over.sku ?? "SKU1",
  name: over.name,
  category: over.category ?? "Bracelets",
  subcategory: over.subcategory,
  style: over.style,
  colors: over.colors,
  tags: over.tags,
  keywords: over.keywords,
  title: over.title,
});

describe("queryTokens", () => {
  it("drops filler words so 'necklace for women' is just necklace", () => {
    const groups = queryTokens("gold necklace for women");
    expect(groups.map((g) => g[0])).toEqual(["gold", "necklace"]);
  });
});

describe("matchesQuery", () => {
  it("matches every word in any order (Prisha gold watch)", () => {
    const p = P({ name: "Prisha Floral Design Gold Watch", category: "Bracelets" });
    expect(matchesQuery(p, "prisha gold watch")).toBe(true);
    expect(matchesQuery(p, "Watch")).toBe(true);
    expect(matchesQuery(p, "watches")).toBe(true);
  });

  it("finds a watch from the AI title when the category is a vague bracelet", () => {
    const p = P({
      name: "Prisha Floral Gold",
      category: "Bracelets",
      title: "Prisha Floral Design Gold Bracelet Watch for Women",
    });
    expect(matchesQuery(p, "Watch")).toBe(true);
    expect(matchesQuery(p, "bracelet watch")).toBe(true);
  });

  it("finds by colour even when the name has no colour word", () => {
    const p = P({ name: "Ananya Kundan Necklace", category: "Necklace", colors: ["Maroon", "Gold"] });
    expect(matchesQuery(p, "maroon")).toBe(true);
  });

  it("does not treat 'ring' as a hit inside 'earrings'", () => {
    const p = P({ name: "Diya AD Jhumka Earrings", category: "Earrings" });
    expect(matchesQuery(p, "ring")).toBe(false);
    expect(matchesQuery(p, "jhumka")).toBe(true);
  });

  it("ignores stopwords so natural phrases still hit", () => {
    const p = P({ name: "Ananya Kundan Necklace Set", category: "Necklace" });
    expect(matchesQuery(p, "kundan necklace for women")).toBe(true);
  });

  it("requires every remaining word", () => {
    const p = P({ name: "Ananya Kundan Necklace", category: "Necklace" });
    expect(matchesQuery(p, "kundan watch")).toBe(false);
  });

  it("matches a SKU fragment", () => {
    const p = P({ name: "Ananya Kundan Necklace", sku: "WN84-ALL", category: "Necklace" });
    expect(matchesQuery(p, "wn84")).toBe(true);
  });
});

describe("rankSearch", () => {
  it("ranks a name hit above a tag-only hit", () => {
    const watch = P({ name: "Prisha Floral Design Gold Watch", sku: "W1", category: "Bracelets" });
    const tagged = P({ name: "Siya Pearl Bracelet", sku: "B1", category: "Bracelets", tags: ["watch-style"] });
    const ranked = rankSearch([tagged, watch], "watch");
    expect(ranked[0].sku).toBe("W1");
  });

  it("returns nothing for a blank query", () => {
    expect(rankSearch([P({ name: "Ananya Kundan Necklace" })], "   ")).toEqual([]);
  });
});
