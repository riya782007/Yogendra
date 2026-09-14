import { describe, it, expect } from "vitest";
import { resolveProductContent, templateContent } from "../lib/content";

describe("content resolver (no model on request path)", () => {
  it("uses cached generated_content when present", () => {
    const c = resolveProductContent({
      name: "BD1", sku: "BD1",
      generated_content: { title: "Cached", description: "d", specs: {}, tags: [], seo: { metaTitle: "m", metaDescription: "md", keywords: [] } },
    });
    expect(c.title).toBe("Cached");
  });
  it("uses the saved product name over a stale cached title", () => {
    const c = resolveProductContent({
      name: "Sara Handcrafted Metal Link Choker Necklace", sku: "N510",
      generated_content: { title: "Ishika Oxidised Choker Set", description: "old", specs: {}, tags: [], seo: { metaTitle: "m", metaDescription: "md", keywords: [] } },
    });
    expect(c.title).toBe("Sara Handcrafted Metal Link Choker Necklace");
  });
  it("falls back to deterministic template when no cache", () => {
    const c = resolveProductContent({ name: "Anklet Pair", sku: "AP1", categoryName: "Anklet", colors: ["Gold", "Silver"] });
    expect(c.title).toBe("Anklet Pair");
    expect(c.description).toContain("Sadar Bazar");
    expect(c.seo.keywords).toContain("Delhi");
    expect(c.specs.Colors).toBe("Gold, Silver");
  });
  it("never returns empty content", () => {
    const c = templateContent({ name: "X", sku: "X1" });
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.description.length).toBeGreaterThan(0);
  });
});
