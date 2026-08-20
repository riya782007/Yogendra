import { describe, it, expect } from "vitest";
import { phoneDigits, phoneMatchesQuery, recordMatchesShopperQuery } from "../lib/phone";

describe("phoneDigits", () => {
  it("strips formatting and leading 00", () => {
    expect(phoneDigits("+230 5452 4641")).toBe("23054524641");
    expect(phoneDigits("00 230 54524641")).toBe("23054524641");
  });
});

describe("phoneMatchesQuery — last 4", () => {
  it("finds a Mauritius visitor by last 4", () => {
    expect(phoneMatchesQuery("+23054524641", "4641")).toBe(true);
    expect(phoneMatchesQuery("230 5452 4641", "4641")).toBe(true);
  });
  it("finds an Indian 10-digit number by last 4", () => {
    expect(phoneMatchesQuery("+91 98765 43210", "3210")).toBe(true);
    expect(phoneMatchesQuery("9876543210", "3210")).toBe(true);
  });
  it("does not match a different last 4", () => {
    expect(phoneMatchesQuery("+23054524641", "1111")).toBe(false);
  });
  it("matches a full number in any format", () => {
    expect(phoneMatchesQuery("+23054524641", "23054524641")).toBe(true);
    expect(phoneMatchesQuery("+23054524641", "+230 5452 4641")).toBe(true);
  });
});

describe("recordMatchesShopperQuery", () => {
  it("matches name when the query is not digits", () => {
    expect(recordMatchesShopperQuery({ phone: "9999", customer_name: "Pooja Yadav" }, "pooja")).toBe(true);
  });
});
