import { describe, it, expect } from "vitest";
import {
  isCancelledSale, isLiveSale, phoneLast10, directoryNameKey,
  collapseDirectoryCustomers, isWalkInPlaceholder, pickDirectoryKeeper,
} from "../lib/customers";

describe("cancelled bills are not sales", () => {
  it("treats cancelled / US spelling / refunded / void as cancelled", () => {
    expect(isCancelledSale("cancelled")).toBe(true);
    expect(isCancelledSale("Cancelled")).toBe(true);
    expect(isCancelledSale("canceled")).toBe(true);
    expect(isCancelledSale("refunded")).toBe(true);
    expect(isCancelledSale("void")).toBe(true);
    expect(isCancelledSale("completed")).toBe(false);
    expect(isCancelledSale(null)).toBe(false);
  });

  it("drops pending backorders and held COD from live sales", () => {
    expect(isLiveSale({ status: "completed" })).toBe(true);
    expect(isLiveSale({ status: "cancelled" })).toBe(false);
    expect(isLiveSale({ status: "completed", is_backorder: true })).toBe(false);
    expect(isLiveSale({ status: "completed", cod_hold: true })).toBe(false);
  });
});

describe("one directory row per customer", () => {
  it("collapses The Opal Factory R / W / R with no phone into the wholesale keeper", () => {
    const rows = [
      { id: "r1", name: "The Opal Factory", phone: null, type: "retail", created_at: "2026-08-17T10:00:00Z" },
      { id: "w1", name: "The Opal Factory", phone: "", type: "wholesale", created_at: "2026-08-17T11:00:00Z" },
      { id: "r2", name: "the  opal factory", phone: null, type: "retail", created_at: "2026-08-17T12:00:00Z" },
    ];
    const out = collapseDirectoryCustomers(rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("w1");
  });

  it("does not merge two different people who share a first name but different phones", () => {
    const out = collapseDirectoryCustomers([
      { id: "a", name: "Priya", phone: "9876543210", type: "retail" },
      { id: "b", name: "Priya", phone: "9123456789", type: "retail" },
    ]);
    expect(out).toHaveLength(2);
  });

  it("normalises name keys and last-10 phone", () => {
    expect(directoryNameKey("  The  Opal Factory ")).toBe("the opal factory");
    expect(phoneLast10("+91 98765 43210")).toBe("9876543210");
    expect(phoneLast10("123")).toBe("");
  });

  it("ignores walk-in cash placeholders", () => {
    expect(isWalkInPlaceholder("Cash (R)", "")).toBe(true);
    expect(isWalkInPlaceholder("The Opal Factory", "")).toBe(false);
    expect(isWalkInPlaceholder("Cash (R)", "9876543210")).toBe(false);
  });

  it("prefers wholesale then a row that already has a phone", () => {
    const k = pickDirectoryKeeper([
      { type: "retail", phone: "9876543210", created_at: "2026-01-01" },
      { type: "wholesale", phone: null, created_at: "2026-06-01" },
    ]);
    expect(k?.type).toBe("wholesale");
  });
});
