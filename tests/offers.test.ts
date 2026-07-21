import { describe, it, expect } from "vitest";
import { deriveOffer, liveOffer } from "../lib/offers";
import { DEFAULT_FORMULA } from "../lib/pricing";

describe("deriveOffer", () => {
  it("computes percent off and savings", () => {
    const o = deriveOffer(41000, 32900); // ₹410 -> ₹329 (incumbent example)
    expect(o.savings).toBe(8100);
    expect(o.offerPct).toBe(20);
    expect(o.hasOffer).toBe(true);
  });
  it("no offer when price equals mrp", () => {
    expect(deriveOffer(10000, 10000).hasOffer).toBe(false);
  });
  it("never negative", () => {
    const o = deriveOffer(10000, 12000);
    expect(o.savings).toBe(0);
    expect(o.offerPct).toBe(0);
  });
});

describe("liveOffer", () => {
  it("derives an offer from base wholesale + formula", () => {
    const o = liveOffer(15000, DEFAULT_FORMULA); // ₹150 base
    expect(o.price).toBe(33000); // retail 330
    expect(o.mrp).toBe(41300);   // mrp ~413
    expect(o.offerPct).toBeGreaterThan(0);
  });
});
