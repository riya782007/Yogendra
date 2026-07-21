/**
 * Demo smoke test — walks the seeded "happy path" through the pure pipeline and
 * asserts every step yields valid, non-empty, demo-ready output (Req 9 / E.5).
 * Deterministic: same seed in => same result out.
 */
import { describe, it, expect } from "vitest";
import { computePrices, isValidPriceSet, DEFAULT_FORMULA } from "../lib/pricing";
import { liveOffer } from "../lib/offers";
import { classify, summarize, DEFAULT_RULE } from "../lib/inventory";
import { resolveProductContent } from "../lib/content";

// mirrors the live seed (name, category, base ₹, qty, daysSinceMovement|null)
const SEED: [string, string, number, number, number | null][] = [
  ["Rajwadi Kundan Necklace Set", "Necklace", 850, 12, 2],
  ["Antique Gold Rani Haar", "Necklace", 1850, 4, 40],
  ["Beaded Boho Necklace", "Necklace", 280, 0, 55],
  ["Oxidised Silver Kada", "Bracelet", 360, 2, 6],
  ["Jhumka Kundan Earrings", "Earrings", 380, 22, 1],
  ["Pearl Solitaire Ring", "Ring", 210, 5, null],
];
const NOW = new Date("2026-06-20T00:00:00Z");
const daysAgo = (d: number | null) => (d == null ? null : new Date(NOW.getTime() - d * 86400000).toISOString());

describe("demo smoke: seeded happy path", () => {
  it("every product produces a valid, positive price set", () => {
    for (const [name, , base] of SEED) {
      const p = computePrices(base * 100, DEFAULT_FORMULA);
      expect(isValidPriceSet(p), `valid price for ${name}`).toBe(true);
      expect(p.retailPrice).toBeGreaterThan(0);
    }
  });

  it("every product shows a live offer (20%-ish off MRP)", () => {
    for (const [name, , base] of SEED) {
      const o = liveOffer(base * 100, DEFAULT_FORMULA);
      expect(o.hasOffer, `${name} has offer`).toBe(true);
      expect(o.offerPct).toBeGreaterThanOrEqual(15);
      expect(o.offerPct).toBeLessThanOrEqual(30);
    }
  });

  it("product content resolves to non-empty title + description + SEO", () => {
    for (const [name, cat] of SEED) {
      const c = resolveProductContent({ name, sku: "BD0000", categoryName: cat });
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(40);
      expect(c.seo.keywords.length).toBeGreaterThan(0);
      expect(c.seo.metaTitle).toContain("Blythe Diva");
    }
  });

  it("inventory classifies into a non-trivial mix (dashboard tiles non-zero)", () => {
    const items = SEED.map(([, , , qty, d]) => ({ qty, lastMovementAt: daysAgo(d) }));
    const sum = summarize(items, DEFAULT_RULE, NOW);
    expect(sum.dead).toBeGreaterThan(0);
    expect(sum.low).toBeGreaterThan(0);
    expect(sum.inactive).toBeGreaterThan(0);
    expect(sum.dead + sum.low + sum.inactive + sum.healthy).toBe(SEED.length);
  });

  it("dashboard revenue aggregate is non-zero", () => {
    const revenue = SEED.reduce((s, [, , base, qty]) => s + liveOffer(base * 100, DEFAULT_FORMULA).price * Math.max(1, qty), 0);
    expect(revenue).toBeGreaterThan(0);
  });
});
