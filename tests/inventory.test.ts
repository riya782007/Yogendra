import { describe, it, expect } from "vitest";
import { classify, summarize, DEFAULT_RULE, type InventoryRule } from "../lib/inventory";

const R: InventoryRule = DEFAULT_RULE; // { deadDays: 30, lowQty: 2 }
const NOW = new Date("2026-06-20T00:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("classify", () => {
  it("never-moved item is inactive", () => {
    expect(classify({ qty: 10, lastMovementAt: null }, R, NOW)).toBe("inactive");
  });
  it("moved today with healthy stock is healthy", () => {
    expect(classify({ qty: 10, lastMovementAt: daysAgo(1) }, R, NOW)).toBe("healthy");
  });
  it("boundary: exactly 30 days stale is dead", () => {
    expect(classify({ qty: 10, lastMovementAt: daysAgo(30) }, R, NOW)).toBe("dead");
  });
  it("boundary: 29 days is not yet dead", () => {
    expect(classify({ qty: 10, lastMovementAt: daysAgo(29) }, R, NOW)).toBe("healthy");
  });
  it("boundary: qty exactly at lowQty (2) is low", () => {
    expect(classify({ qty: 2, lastMovementAt: daysAgo(5) }, R, NOW)).toBe("low");
  });
  it("boundary: qty just above lowQty (3) is healthy", () => {
    expect(classify({ qty: 3, lastMovementAt: daysAgo(5) }, R, NOW)).toBe("healthy");
  });
  it("stale takes precedence over low", () => {
    expect(classify({ qty: 1, lastMovementAt: daysAgo(45) }, R, NOW)).toBe("dead");
  });
  it("rule change reclassifies (deadDays=60)", () => {
    const item = { qty: 10, lastMovementAt: daysAgo(45) };
    expect(classify(item, R, NOW)).toBe("dead");
    expect(classify(item, { ...R, deadDays: 60 }, NOW)).toBe("healthy");
  });
});

describe("summarize", () => {
  it("counts each class", () => {
    const items = [
      { qty: 10, lastMovementAt: daysAgo(1) },   // healthy
      { qty: 1, lastMovementAt: daysAgo(2) },    // low
      { qty: 5, lastMovementAt: daysAgo(40) },   // dead
      { qty: 5, lastMovementAt: null },          // inactive
    ];
    expect(summarize(items, R, NOW)).toEqual({ healthy: 1, low: 1, dead: 1, inactive: 1 });
  });
});
