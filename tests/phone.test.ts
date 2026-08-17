import { describe, it, expect } from "vitest";
import {
  phoneDigits, phoneMatchesQuery, phonesAreSameShopper, recordMatchesShopperQuery, whatsAppDigits,
} from "../lib/phone";

describe("phone last-4 / international matching", () => {
  it("matches last 4 of a US number in any format", () => {
    const phones = ["+1 783-739-1427", "+17837391427", "17837391427", "783-739-1427", "7837391427"];
    for (const p of phones) {
      expect(phoneMatchesQuery(p, "1427"), p).toBe(true);
      expect(phoneMatchesQuery(p, "91427"), p).toBe(true);
    }
  });

  it("matches last 4 of an Indian number with or without +91", () => {
    expect(phoneMatchesQuery("+91 98765 43210", "3210")).toBe(true);
    expect(phoneMatchesQuery("9876543210", "3210")).toBe(true);
    expect(phoneMatchesQuery("919876543210", "43210")).toBe(true);
  });

  it("does not match a different last 4", () => {
    expect(phoneMatchesQuery("+1 783-739-1427", "9999")).toBe(false);
    expect(phoneMatchesQuery("9876543210", "1427")).toBe(false);
  });

  it("treats +1 and local US as the same shopper, not last-4 collisions", () => {
    expect(phonesAreSameShopper("+1 783-739-1427", "7837391427")).toBe(true);
    expect(phonesAreSameShopper("9876543210", "919876543210")).toBe(true);
    expect(phonesAreSameShopper("+1 783-739-1427", "9997391427")).toBe(false);
  });

  it("matches a cart row by last 4 or by name", () => {
    const cart = { customer_name: "Diksha", phone: "+1 783-739-1427" };
    expect(recordMatchesShopperQuery(cart, "1427")).toBe(true);
    expect(recordMatchesShopperQuery(cart, "dik")).toBe(true);
    expect(recordMatchesShopperQuery(cart, "0000")).toBe(false);
  });

  it("does not force +91 onto a US E.164 number", () => {
    expect(whatsAppDigits("+1 783-739-1427")).toBe("17837391427");
    expect(whatsAppDigits("9876543210")).toBe("919876543210");
    expect(whatsAppDigits("+91 98765 43210")).toBe("919876543210");
  });

  it("strips formatting to digits", () => {
    expect(phoneDigits("+1 (783) 739-1427")).toBe("17837391427");
  });
});
