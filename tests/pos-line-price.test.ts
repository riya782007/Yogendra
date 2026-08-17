import { describe, it, expect } from "vitest";
import { posItemPayload, invoiceLineDisplay } from "../lib/posLinePrice";

describe("POS edited rate is the bill rate, not a discount", () => {
  it("knocking ₹60 down to ₹50 stores ₹50 as Rate with no Disc", () => {
    const row = posItemPayload({
      sku: "X", qty: 1, billedPaise: 5000, ratePaise: 5000, hasExplicitDisc: false,
    });
    expect(row.priceRupees).toBe(50);
    expect(row.listRupees).toBeUndefined();
    const inv = invoiceLineDisplay({ unit_price: 5000, unit_mrp: null });
    expect(inv.isDiscounted).toBe(false);
    expect(inv.ratePaise).toBe(5000);
    expect(inv.discPct).toBe(0);
  });

  it("raising ₹60 to ₹80 stores ₹80 as Rate with no Disc", () => {
    const row = posItemPayload({
      sku: "X", qty: 2, billedPaise: 8000, ratePaise: 8000, hasExplicitDisc: false,
    });
    expect(row.priceRupees).toBe(80);
    expect(row.listRupees).toBeUndefined();
    const inv = invoiceLineDisplay({ unit_price: 8000, unit_mrp: 6000 });
    expect(inv.isDiscounted).toBe(false);
    expect(inv.ratePaise).toBe(8000);
  });

  it("Disc column still prints Rate → Disc → Amount", () => {
    const row = posItemPayload({
      sku: "X", qty: 1, billedPaise: 5000, ratePaise: 6000, hasExplicitDisc: true,
    });
    expect(row.priceRupees).toBe(50);
    expect(row.listRupees).toBe(60);
    const inv = invoiceLineDisplay({ unit_price: 5000, unit_mrp: 6000 });
    expect(inv.isDiscounted).toBe(true);
    expect(inv.ratePaise).toBe(6000);
    expect(inv.discPct).toBe(17);
  });
});
