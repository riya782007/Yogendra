import { describe, it, expect } from "vitest";
import {
  billGrandPaise, directoryIdsForOrder, directoryNameKey, istMonthStartISO, targetingRange, isLiveSale,
} from "../lib/customerSpend";

describe("customer target spend", () => {
  const pooja = { id: "a", name: "Pooja Fashion", phone: null };
  const pooja2 = { id: "b", name: "POOJA  FASHION", phone: "" };
  const dir = [pooja, pooja2, { id: "c", name: "Other", phone: "9876543210" }];

  it("counts a ₹46,000 GST bill at the printed grand total (inclusive / unpinned)", () => {
    expect(billGrandPaise({ total: 4600000, bill_type: "gst", gst_mode: "inclusive" })).toBe(4600000);
    expect(billGrandPaise({ total: 4600000, bill_type: "gst", gst_mode: null })).toBe(4600000);
  });

  it("adds 3% only when the bill is pinned exclusive", () => {
    expect(billGrandPaise({ total: 4466000, bill_type: "gst", gst_mode: "exclusive" })).toBe(4600000);
  });

  it("attributes an unlinked Pooja Fashion bill to every same-name directory row", () => {
    const ids = directoryIdsForOrder({ customer_id: null, customer_name: "Pooja Fashion", customer_phone: null }, dir);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("attributes a linked bill to all name copies so the owner never sees ₹36k on the old row", () => {
    const ids = directoryIdsForOrder({ customer_id: "b", customer_name: "Pooja Fashion" }, dir);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("does not mix two different firms", () => {
    expect(directoryNameKey("Pooja Fashion")).toBe("pooja fashion");
    const ids = directoryIdsForOrder({ customer_name: "Other", customer_phone: "9876543210" }, dir);
    expect(ids).toEqual(["c"]);
  });

  it("uses India calendar month, not UTC", () => {
    const aug = targetingRange("month", new Date("2026-08-16T22:00:00+05:30"));
    expect(aug.from).toBe(istMonthStartISO(new Date("2026-08-16T22:00:00+05:30")));
    expect(new Date(aug.from!).toISOString()).toBe("2026-07-31T18:30:00.000Z");
  });

  it("drops cancelled bills from live sales", () => {
    expect(isLiveSale({ status: "cancelled" })).toBe(false);
    expect(isLiveSale({ status: "completed" })).toBe(true);
  });
});
