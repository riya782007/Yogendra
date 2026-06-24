import { describe, it, expect } from "vitest";
import { inferStockKind } from "../lib/stockKind";

describe("inferStockKind — maps a source label to a typed movement", () => {
  it("damage", () => {
    expect(inferStockKind("Damaged — removed")).toBe("damage");
    expect(inferStockKind("piece broken in transit")).toBe("damage");
  });
  it("purchase / restock", () => {
    expect(inferStockKind("New purchase / restock")).toBe("purchase");
    expect(inferStockKind("Received from supplier")).toBe("purchase");
  });
  it("return / cancel / sample", () => {
    expect(inferStockKind("Returned from cart (in-store)")).toBe("return");
    expect(inferStockKind("Customer cancelled")).toBe("return");
    expect(inferStockKind("Sample returned")).toBe("return");
  });
  it("recount", () => {
    expect(inferStockKind("Found / recount")).toBe("recount");
  });
  it("correction", () => {
    expect(inferStockKind("Correction")).toBe("correction");
  });
  it("sale", () => {
    expect(inferStockKind("POS sale")).toBe("sale");
  });
  it("falls back to manual", () => {
    expect(inferStockKind("")).toBe("manual");
    expect(inferStockKind("something else")).toBe("manual");
  });
});
