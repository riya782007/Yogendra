import { describe, it, expect } from "vitest";
import {
  computePrices, resolvePrices, priceForTier, tierForCustomer, overridesOf, DEFAULT_FORMULA,
} from "../lib/pricing";

const f = DEFAULT_FORMULA; // wholesaleMarkup 10%, retail x2.2, mrp x2.75, round ₹1
const base = 100000; // ₹1000 in paise

describe("resolvePrices — variant → product → formula hierarchy", () => {
  it("uses the formula when there are no overrides", () => {
    expect(resolvePrices(base, f)).toEqual(computePrices(base, f));
  });

  it("a product override beats the formula, untouched tiers stay on the formula", () => {
    const r = resolvePrices(base, f, null, { retail: 150000 });
    expect(r.retailPrice).toBe(150000);
    expect(r.mrp).toBe(computePrices(base, f).mrp);
    expect(r.wholesaleRate).toBe(computePrices(base, f).wholesaleRate);
  });

  it("a variant override beats a product override", () => {
    const r = resolvePrices(base, f, { retail: 199900 }, { retail: 150000 });
    expect(r.retailPrice).toBe(199900);
  });

  it("ignores zero / negative overrides (treated as 'inherit')", () => {
    const r = resolvePrices(base, f, { retail: 0 }, { retail: -5 });
    expect(r.retailPrice).toBe(computePrices(base, f).retailPrice);
  });
});

describe("tier helpers", () => {
  it("priceForTier reads the right field", () => {
    const p = { wholesaleRate: 1, retailPrice: 2, mrp: 3 };
    expect(priceForTier(p, "wholesale")).toBe(1);
    expect(priceForTier(p, "retail")).toBe(2);
    expect(priceForTier(p, "mrp")).toBe(3);
  });

  it("tierForCustomer maps wholesale buyers to wholesale, everyone else to retail", () => {
    expect(tierForCustomer("wholesale")).toBe("wholesale");
    expect(tierForCustomer("retail")).toBe("retail");
    expect(tierForCustomer(null)).toBe("retail");
    expect(tierForCustomer(undefined)).toBe("retail");
  });

  it("overridesOf maps DB *_override columns (null when absent)", () => {
    expect(overridesOf({ retail_override: 500, wholesale_override: null })).toEqual({ wholesale: null, retail: 500, mrp: null });
    expect(overridesOf(null)).toEqual({ wholesale: null, retail: null, mrp: null });
  });
});
