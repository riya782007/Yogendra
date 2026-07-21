import { describe, it, expect } from "vitest";
import {
  computePrices, isValidPriceSet, priceProduct, formatPaise,
  DEFAULT_FORMULA, type PricingFormula,
} from "../lib/pricing";

const F: PricingFormula = DEFAULT_FORMULA;

describe("computePrices", () => {
  it("computes wholesale/retail/mrp from base wholesale (₹150 base)", () => {
    const p = computePrices(15000, F); // ₹150 in paise
    expect(p.wholesaleRate).toBe(16500); // 150 * 1.10 = 165
    expect(p.retailPrice).toBe(33000);   // 150 * 2.2 = 330
    expect(p.mrp).toBe(41300);           // 150 * 2.75 = 412.5 -> round to ₹413 (41300)
  });

  it("rounds to the configured granularity (nearest rupee by default)", () => {
    const p = computePrices(12345, F); // ₹123.45
    expect(p.retailPrice % 100).toBe(0);
    expect(p.mrp % 100).toBe(0);
    expect(p.wholesaleRate % 100).toBe(0);
  });

  it("recomputes when the formula changes (one formula re-prices)", () => {
    const cheap = computePrices(15000, { ...F, retailMultiplier: 2.0 });
    const rich = computePrices(15000, { ...F, retailMultiplier: 3.0 });
    expect(rich.retailPrice).toBeGreaterThan(cheap.retailPrice);
  });
});

describe("isValidPriceSet", () => {
  it("accepts a normal set", () => {
    expect(isValidPriceSet(computePrices(15000, F))).toBe(true);
  });
  it("rejects non-positive base", () => {
    expect(priceProduct(0, F).valid).toBe(false);
    expect(priceProduct(-500, F).valid).toBe(false);
  });
  it("rejects NaN / non-finite base", () => {
    expect(priceProduct(NaN, F).valid).toBe(false);
  });
  it("rejects retail above MRP", () => {
    expect(isValidPriceSet({ wholesaleRate: 100, retailPrice: 500, mrp: 400 })).toBe(false);
  });
  it("rejects wholesale >= retail", () => {
    expect(isValidPriceSet({ wholesaleRate: 400, retailPrice: 400, mrp: 600 })).toBe(false);
  });
});

describe("formatPaise", () => {
  it("formats paise to rupees with Indian grouping", () => {
    expect(formatPaise(150000)).toBe("₹1,500");
    expect(formatPaise(NaN)).toBe("—");
  });
});
